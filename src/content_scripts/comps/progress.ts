export default function Progress(value: number, max: number, label: string = "\uCD9C\uC11D \uAE30\uC900") {
    const el = document.createElement("div");
    el.className = "ecx-progress";

    const bar = document.createElement("progress");
    bar.className = "ecx-progress-bar";
    const safeMax = Math.max(max, 1);
    const clampedValue = Math.min(value, safeMax);
    bar.value = clampedValue;
    bar.max = safeMax;

    const text = document.createElement("span");
    text.className = "ecx-progress-text";

    const elapsed = formatSec(value);
    const total = formatSec(max);
    const pct = ((clampedValue / safeMax) * 100).toFixed(1);
    text.textContent = label
        ? `\uC2DC\uCCAD ${elapsed} / ${label} ${total} (${pct}%)`
        : `\uC2DC\uCCAD ${elapsed} / ${total} (${pct}%)`;

    el.append(bar, text);
    return el;
}

function formatSec(sec: number): string {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}
