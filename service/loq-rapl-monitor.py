#!/usr/bin/env python3
"""Read-only Intel RAPL package power sampler for the Cinnamon applet."""
import json
import os
import signal
import time
from pathlib import Path

ROOT = Path('/sys/class/powercap/intel-rapl:0')
OUTPUT = Path('/run/loq-rapl-monitor/cpu_power.json')
RUNNING = True


def stop(_signum, _frame):
    global RUNNING
    RUNNING = False


def read_int(filename):
    return int((ROOT / filename).read_text().strip())


def publish(watts):
    temp = OUTPUT.with_suffix('.tmp')
    temp.write_text(json.dumps({'timestamp': time.time(), 'watts': round(watts, 2)}) + '\n')
    os.chmod(temp, 0o644)
    os.replace(temp, OUTPUT)


def main():
    if (ROOT / 'name').read_text().strip() != 'package-0':
        raise RuntimeError('RAPL package-0 not found')
    maximum = read_int('max_energy_range_uj')
    if maximum <= 0:
        raise RuntimeError('Invalid RAPL counter range')
    previous_energy = read_int('energy_uj')
    previous_time = time.monotonic()
    while RUNNING:
        time.sleep(1)
        now = time.monotonic()
        energy = read_int('energy_uj')
        elapsed = now - previous_time
        delta = (energy - previous_energy) % maximum
        watts = delta / 1_000_000 / elapsed if elapsed > 0 else float('nan')
        if 0 <= watts <= 300:
            publish(watts)
        previous_energy, previous_time = energy, now


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    main()
