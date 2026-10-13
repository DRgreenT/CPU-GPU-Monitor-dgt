const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const RAPL_FILE = '/run/loq-rapl-monitor/cpu_power.json';
const REFRESH_SECONDS = 2;

function readText(path) {
    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        return ok ? imports.byteArray.toString(bytes).trim() : null;
    } catch (e) { return null; }
}
function formatNumber(value, decimals = 0) {
    return Number.isFinite(value) ? value.toFixed(decimals) : '—';
}
function readCpuTemperature() {
    try {
        const dir = Gio.File.new_for_path('/sys/class/hwmon');
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let entry;
        while ((entry = enumerator.next_file(null)) !== null) {
            const root = '/sys/class/hwmon/' + entry.get_name();
            if (readText(root + '/name') !== 'coretemp') continue;
            for (let i = 1; i <= 40; i++) {
                if (readText(root + `/temp${i}_label`) !== 'Package id 0') continue;
                const raw = readText(root + `/temp${i}_input`);
                if (raw === null) return null;
                const millidegrees = Number(raw);
                return Number.isFinite(millidegrees) ? millidegrees / 1000 : null;
            }
        }
    } catch (e) { global.logError(e); }
    return null;
}
function readCpuCounters() {
    const line = (readText('/proc/stat') || '').split('\n')[0].trim().split(/\s+/);
    if (line[0] !== 'cpu' || line.length < 8) return null;
    const values = line.slice(1).map(Number);
    if (values.some(v => !Number.isFinite(v))) return null;
    const total = values.reduce((a, b) => a + b, 0);
    const idle = values[3] + values[4];
    return { total, idle };
}
function readCpuLimits() {
    const root = '/sys/class/powercap/intel-rapl:0/';
    if (readText(root + 'name') !== 'package-0') return { pl1: null, pl2: null };
    const result = { pl1: null, pl2: null };
    for (let i = 0; i < 4; i++) {
        const name = readText(root + `constraint_${i}_name`);
        const raw = readText(root + `constraint_${i}_power_limit_uw`);
        const watts = raw === null ? NaN : Number(raw) / 1000000;
        if (!Number.isFinite(watts) || watts <= 0) continue;
        if (name === 'long_term') result.pl1 = watts;
        if (name === 'short_term') result.pl2 = watts;
    }
    return result;
}
function readRaplWatts() {
    const text = readText(RAPL_FILE);
    if (!text) return null;
    try {
        const data = JSON.parse(text);
        // The helper supplies wall-clock timestamps, not monotonic timestamps.
        const age = Date.now() / 1000 - Number(data.timestamp);
        const watts = Number(data.watts);
        return age >= -5 && age <= 8 && Number.isFinite(watts) && watts >= 0 && watts <= 300 ? watts : null;
    } catch (e) { return null; }
}

class CpuGpuMonitor extends Applet.TextApplet {
    constructor(orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.set_applet_tooltip('CPU/GPU Monitor');
        this.set_applet_label('CPU —  GPU —');
        this._destroyed = false;
        this._gpuBusy = false;
        this._previousCpu = null;
        this._gpu = { temp: null, util: null, draw: null, limit: null };
        this._lastValidGpuLimit = null;
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._cpuTitle = new PopupMenu.PopupMenuItem('CPU', { reactive: false });
        this._cpuStats = new PopupMenu.PopupMenuItem('Lade CPU-Daten …', { reactive: false });
        this._cpuPower = new PopupMenu.PopupMenuItem('Leistung: —', { reactive: false });
        this._cpuLimits = new PopupMenu.PopupMenuItem('PL1 / PL2: — / —', { reactive: false });
        this._gpuTitle = new PopupMenu.PopupMenuItem('NVIDIA GPU', { reactive: false });
        this._gpuStats = new PopupMenu.PopupMenuItem('Lade GPU-Daten …', { reactive: false });
        this._gpuPower = new PopupMenu.PopupMenuItem('Leistung: —', { reactive: false });
        this._gpuLimit = new PopupMenu.PopupMenuItem('Power-Limit: —', { reactive: false });
        this.menu.addMenuItem(this._cpuTitle);
        this.menu.addMenuItem(this._cpuStats);
        this.menu.addMenuItem(this._cpuPower);
        this.menu.addMenuItem(this._cpuLimits);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._gpuTitle);
        this.menu.addMenuItem(this._gpuStats);
        this.menu.addMenuItem(this._gpuPower);
        this.menu.addMenuItem(this._gpuLimit);
        this._refresh();
        this._timer = Mainloop.timeout_add_seconds(REFRESH_SECONDS, () => {
            if (this._destroyed) return false;
            this._refresh();
            return true;
        });
    }
    on_applet_clicked() { this.menu.toggle(); }
    _refresh() {
        const temp = readCpuTemperature();
        const counters = readCpuCounters();
        let utilization = null;
        if (counters && this._previousCpu) {
            const total = counters.total - this._previousCpu.total;
            const idle = counters.idle - this._previousCpu.idle;
            if (total > 0) utilization = Math.max(0, Math.min(100, 100 * (total - idle) / total));
        }
        this._previousCpu = counters;
        const limits = readCpuLimits();
        const watts = readRaplWatts();
        this._cpuStats.label.text = `Temperatur: ${formatNumber(temp)} °C    Auslastung: ${formatNumber(utilization)} %`;
        this._cpuPower.label.text = `Leistungsaufnahme: ${formatNumber(watts, 1)} W`;
        this._cpuLimits.label.text = `PL1: ${formatNumber(limits.pl1)} W    PL2: ${formatNumber(limits.pl2)} W`;
        this._cpuPanel = `CPU ${formatNumber(temp)}° ${formatNumber(utilization)}%`;
        this._updatePanel();
        this._pollGpu();
    }
    _updatePanel() {
        this.set_applet_label(`${this._cpuPanel || 'CPU —'}  |  GPU ${formatNumber(this._gpu.temp)}° ${formatNumber(this._gpu.util)}%`);
        this._gpuStats.label.text = `Temperatur: ${formatNumber(this._gpu.temp)} °C    Auslastung: ${formatNumber(this._gpu.util)} %`;
        this._gpuPower.label.text = `Leistungsaufnahme: ${formatNumber(this._gpu.draw, 1)} W`;
        this._gpuLimit.label.text = `Power-Limit: ${formatNumber(this._gpu.limit)} W${this._gpu.limit !== null && this._gpu.stale ? ' (letzter gültiger Wert)' : ''}`;
    }
    _pollGpu() {
        if (this._gpuBusy) return;
        this._gpuBusy = true;
        const args = ['nvidia-smi', '--query-gpu=temperature.gpu,utilization.gpu,power.draw,power.limit', '--format=csv,noheader,nounits'];
        try {
            const proc = new Gio.Subprocess({ argv: args, flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, result) => {
                this._gpuBusy = false;
                if (this._destroyed) return;
                try {
                    const [ok, stdout] = p.communicate_utf8_finish(result);
                    if (!ok || !p.get_successful()) throw new Error('nvidia-smi failed');
                    const fields = stdout.trim().split('\n')[0].split(',').map(s => s.trim());
                    if (fields.length < 4) throw new Error('Invalid nvidia-smi response');
                    const parse = s => /^(N\/A|\[N\/A\]|)$/i.test(s) ? null : Number(s);
                    const [temp, util, draw, limit] = fields.map(parse);
                    this._gpu.temp = Number.isFinite(temp) && temp >= 0 && temp <= 110 ? temp : null;
                    this._gpu.util = Number.isFinite(util) && util >= 0 && util <= 100 ? util : null;
                    // Laptop-specific sanity check: reject bogus idle readings such as 590 W.
                    this._gpu.draw = Number.isFinite(draw) && draw >= 0 && draw <= 150 ? draw : null;
                    if (Number.isFinite(limit) && limit >= 5 && limit <= 150) this._lastValidGpuLimit = limit;
                    this._gpu.limit = this._lastValidGpuLimit;
                    this._gpu.stale = !(Number.isFinite(limit) && limit >= 5 && limit <= 150);
                } catch (e) {
                    this._gpu.temp = null;
                    this._gpu.util = null;
                    this._gpu.draw = null;
                    this._gpu.limit = this._lastValidGpuLimit;
                    this._gpu.stale = true;
                }
                this._updatePanel();
            });
        } catch (e) {
            this._gpuBusy = false;
            this._gpu.temp = null;
            this._gpu.util = null;
            this._gpu.draw = null;
            this._updatePanel();
        }
    }
    on_applet_removed_from_panel() {
        this._destroyed = true;
        if (this._timer) Mainloop.source_remove(this._timer);
    }
}
function main(metadata, orientation, panelHeight, instanceId) {
    return new CpuGpuMonitor(orientation, panelHeight, instanceId);
}
