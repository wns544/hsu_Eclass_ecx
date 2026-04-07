import { Diff } from "./time";

export function formatDate(date: Date): string {
    const mo = date.getMonth() + 1;
    const dt = date.getDate();
    const hr = date.getHours().toString().padStart(2, "0");
    const mn = date.getMinutes().toString().padStart(2, "0");
    return `${mo}/${dt} ${hr}:${mn}`;
}

export function formatDiff({ day, hour, min, sec }: Diff): string {
    let s = "";
    if (day > 0) {
        s += `${day}\uC77C `;
    }
    if (hour > 0) {
        s += `${hour}\uC2DC\uAC04 `;
    }
    if (min > 0) {
        s += `${min}\uBD84 `;
    }
    if (sec > 0) {
        s += `${sec}\uCD08`;
    }
    return s.trim();
}
