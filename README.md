# CPU/GPU Monitor for Cinnamon

Read-only monitoring applet for Lenovo LOQ 15IRX9 (Intel i5-13450HX / NVIDIA RTX 4060 Laptop GPU).

## Installation

```bash
unzip CPU-GPU-Monitor-dgt.zip
cd CPU-GPU-Monitor@dgt
./install.sh
```

Open Cinnamon **System Settings → Applets**, find **CPU/GPU Monitor** and add it to the panel. The installer asks for sudo only to install and start the read-only RAPL sampler.

## Features

- Panel: CPU and GPU temperature and utilization
- Popup: CPU package power, PL1, PL2; GPU power and current power limit
- GPU queried asynchronously with one `nvidia-smi` invocation every 2 seconds
- CPU package energy read by root-owned service, published as read-only JSON under `/run/loq-rapl-monitor/`
- Invalid or missing readings displayed as `—`; previous valid GPU limit is labeled as cached
- No write operations to CPU/GPU power settings

## Diagnostics

```bash
systemctl status loq-rapl-monitor --no-pager
cat /run/loq-rapl-monitor/cpu_power.json
journalctl -u loq-rapl-monitor -n 30 --no-pager
```

## Uninstall

Remove the applet from Cinnamon first, then:

```bash
sudo systemctl disable --now loq-rapl-monitor.service
sudo rm /etc/systemd/system/loq-rapl-monitor.service
sudo rm /usr/local/libexec/loq-rapl-monitor.py
sudo systemctl daemon-reload
rm -rf "$HOME/.local/share/cinnamon/applets/CPU-GPU-Monitor@dgt"
```

## Notes

RAPL `long_term` and `short_term` values are displayed as reported by the kernel, even if the long-term limit exceeds the short-term limit. The helper requires access to `/sys/class/powercap/intel-rapl:0/energy_uj` and is intended for systems where that domain is `package-0`. `nvidia-smi` must be installed and functional. The 150 W GPU sanity threshold is specific to the RTX 4060 Laptop configuration and is not intended as a universal limit.
