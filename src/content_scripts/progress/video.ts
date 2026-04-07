import { insertBelow } from ".";
import { VideoInfo } from "#cs/fetch/video";

import { diff, remaining } from "#/utils/time";
import { formatDiff } from "#/utils/format";

import Horizontal from "#cs/comps/horizontal";
import Progress from "#cs/comps/progress";
import Badge from "#cs/comps/badge";

type Status = "Att" | "Abs" | "Pend" | "Disabled";

export default function videoExt(video: Element, { title, actual, required }: VideoInfo) {
    const name = video.querySelector("span.instancename")!.firstChild!.textContent!.trim();
    if (name !== title) {
        return;
    }

    const dateText = video.querySelector("span.text-ubstrap")!.textContent!.trim();
    const [from, due] = parseDateRange(dateText);
    const [rem, left] = remaining(due);

    const status: Status = (() => {
        if (Date.now() < from.getTime()) {
            return "Disabled";
        }
        if (actual < required) {
            return left ? "Pend" : "Abs";
        }
        return "Att";
    })();

    const duration = readDuration(video);

    const el = Horizontal();
    insertBelow(video, el);

    const progEl = Progress(actual, duration?.seconds ?? required, duration ? "" : "\uCD9C\uC11D \uAE30\uC900");
    const requiredEl = Badge(`\uCD9C\uC11D \uAE30\uC900 ${formatClock(required)}`, "secondary");

    const vRemEl = (() => {
        if (status !== "Pend") {
            return null;
        }
        const vRem = diff(actual, required);
        const vRemText = formatDiff(vRem);
        return Badge(`${vRemText} \uD544\uC694`, "warning");
    })();

    const statusEl = (() => {
        if (status === "Att") {
            return Badge("\uCD9C\uC11D", "success");
        } else if (status === "Abs") {
            return Badge("\uACB0\uC11D", "danger");
        } else if (status === "Pend") {
            const remText = formatDiff(rem);
            return Badge(`${remText} \uB0A8\uC74C`, "primary");
        }
        return Badge("\uC544\uC9C1 \uC218\uAC15 \uAE30\uAC04\uC774 \uC544\uB2D8", "secondary");
    })();

    el.append(...[
        progEl, "\u00A0",
        requiredEl, "\u00A0",
        vRemEl,
        statusEl,
    ].filter(e => e !== null));
}

function readDuration(video: Element) {
    const text = video.querySelector("span.text-info")?.textContent?.trim() ?? "";
    const duration = text.replace(/^,\s*/, "").trim();
    if (!duration) {
        return null;
    }

    return {
        seconds: parseClock(duration),
    };
}

function parseDateRange(text: string): [Date, Date] {
    const matches = [...text.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g)].map(match => match[0]);
    if (matches.length < 2) {
        throw new Error(`Failed to parse date range: ${text}`);
    }
    return [new Date(matches[0]), new Date(matches[1])];
}

function parseClock(text: string): number {
    const parts = text.split(":").map(Number);
    if (parts.length === 3) {
        const [h, m, s] = parts;
        return h * 3600 + m * 60 + s;
    }
    const [m, s] = parts;
    return m * 60 + s;
}

function formatClock(sec: number): string {
    const hour = Math.floor(sec / 3600);
    const min = Math.floor(sec / 60) % 60;
    const rem = sec % 60;
    if (hour > 0) {
        return `${hour}:${min.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
    }
    return `${Math.floor(sec / 60)}:${rem.toString().padStart(2, "0")}`;
}
