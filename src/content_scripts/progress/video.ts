import { insertBelow } from ".";
import { VideoInfo } from "#cs/fetch/video";

import { diff, remaining } from "#/utils/time";
import { formatDiff } from "#/utils/format";

import Horizontal from "#cs/comps/horizontal";
import Progress from "#cs/comps/progress";
import Badge, { ActionBadge } from "#cs/comps/badge";
import {
    DIRECT_DOWNLOAD_STATE_KEY,
    DirectDownloadJobState,
    DirectDownloadStateSnapshot,
    createEmptyDirectDownloadSnapshot,
    getPhaseLabel,
    getPhaseVariant,
    pickViewerJob,
} from "#/shared/direct-download-state";

type Status = "Att" | "Abs" | "Pend" | "Disabled";
const DIRECT_DOWNLOAD_VARIANT_CLASSES = [
    "ecx-badge-primary",
    "ecx-badge-secondary",
    "ecx-badge-success",
    "ecx-badge-danger",
    "ecx-badge-warning",
    "ecx-badge-info",
];

const directDownloadStatusEls = new Map<string, HTMLSpanElement>();
let directDownloadSnapshot = createEmptyDirectDownloadSnapshot();
let directDownloadStateInitialized = false;

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
    insertActionButtons(video);

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

function insertActionButtons(video: Element) {
    const inst = video.querySelector("div.activityinstance");
    const display = video.querySelector("span.displayoptions");
    const link = video.querySelector<HTMLAnchorElement>("a[href*=\"/mod/vod/view.php?id=\"]");
    if (!inst || !display || !link || inst.querySelector(".ecx-video-actions")) {
        return;
    }

    const viewerUrl = link.href.replace("/view.php?", "/viewer.php?");
    const directUrl = new URL(viewerUrl);
    directUrl.searchParams.set("ecxDirectDownload", "1");
    const filename = inst.querySelector("span.instancename")?.textContent?.trim() || "video";
    const courseName = readCourseName();

    const actions = document.createElement("span");
    actions.className = "ecx-video-actions";

    const openEl = ActionBadge("\uC5F4\uAE30", "info", () => {
        window.open(viewerUrl, "_blank", "noopener,noreferrer");
    });

    const copyEl = ActionBadge("\uBCF5\uC0AC", "secondary", async () => {
        const ok = await copyText(viewerUrl);
        copyEl.textContent = ok ? "\uBCF5\uC0AC\uB428" : "\uBCF5\uC0AC \uC2E4\uD328";
        window.setTimeout(() => {
            copyEl.textContent = "\uBCF5\uC0AC";
        }, 1500);
    });

    const downloadEl = ActionBadge("\uB2E4\uC6B4\uB85C\uB4DC", "primary", () => {
        window.open(viewerUrl, "_blank", "noopener,noreferrer");
    });

    const directDownloadEl = ActionBadge("\uC9C1\uC811\uB2E4\uC6B4", "danger", () => {
        void queueDirectDownload(directDownloadEl, directUrl.toString(), filename, courseName);
    });

    const statusEl = Badge("", "secondary");
    statusEl.hidden = true;
    statusEl.classList.add("ecx-direct-download-status");
    directDownloadStatusEls.set(viewerUrl, statusEl);
    ensureDirectDownloadStateSync();
    updateDirectDownloadStatusEl(viewerUrl, statusEl);

    actions.append(openEl, copyEl, downloadEl, directDownloadEl, statusEl);
    display.insertAdjacentElement("afterend", actions);
}

async function queueDirectDownload(button: HTMLButtonElement, viewerUrl: string, filename: string, courseName: string) {
    const original = button.textContent || "\uC9C1\uC811\uB2E4\uC6B4";
    button.disabled = true;
    button.textContent = "\uC900\uBE44\uC911";

    try {
        const res = await chrome.runtime.sendMessage({
            type: "START_DIRECT_DOWNLOAD_JOB",
            viewerUrl,
            filename,
            courseName,
        }) as { ok?: boolean, error?: string };

        if (!res?.ok) {
            throw new Error(res?.error || "Failed to start direct download job.");
        }

        button.textContent = "\uC2DC\uC791\uB428";
    } catch (error) {
        console.error("[ecx] failed to queue direct download", error);
        button.textContent = "\uC2E4\uD328";
    } finally {
        window.setTimeout(() => {
            button.disabled = false;
            button.textContent = original;
        }, 1500);
    }
}

function ensureDirectDownloadStateSync() {
    if (directDownloadStateInitialized) {
        return;
    }

    directDownloadStateInitialized = true;
    void loadDirectDownloadState();

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes[DIRECT_DOWNLOAD_STATE_KEY]) {
            return;
        }

        directDownloadSnapshot = (changes[DIRECT_DOWNLOAD_STATE_KEY].newValue as DirectDownloadStateSnapshot | undefined)
            ?? createEmptyDirectDownloadSnapshot();
        refreshDirectDownloadStatusEls();
    });
}

async function loadDirectDownloadState() {
    const stored = await chrome.storage.local.get(DIRECT_DOWNLOAD_STATE_KEY);
    directDownloadSnapshot = (stored[DIRECT_DOWNLOAD_STATE_KEY] as DirectDownloadStateSnapshot | undefined)
        ?? createEmptyDirectDownloadSnapshot();
    refreshDirectDownloadStatusEls();
}

function refreshDirectDownloadStatusEls() {
    for (const [viewerUrl, statusEl] of directDownloadStatusEls) {
        updateDirectDownloadStatusEl(viewerUrl, statusEl);
    }
}

function updateDirectDownloadStatusEl(viewerUrl: string, statusEl: HTMLSpanElement) {
    const job = pickViewerJob(directDownloadSnapshot.jobs, viewerUrl);
    if (!job) {
        statusEl.hidden = true;
        statusEl.textContent = "";
        return;
    }

    statusEl.hidden = false;
    setBadgeVariant(statusEl, getPhaseVariant(job.phase));
    statusEl.textContent = formatDirectDownloadStatus(job);
}

function setBadgeVariant(statusEl: HTMLSpanElement, variant: string) {
    statusEl.classList.remove(...DIRECT_DOWNLOAD_VARIANT_CLASSES);
    statusEl.classList.add(`ecx-badge-${variant}`);
}

function formatDirectDownloadStatus(job: DirectDownloadJobState) {
    if (job.phase === "downloading" && typeof job.progressPercent === "number") {
        return `${getPhaseLabel(job.phase)} ${job.progressPercent}%`;
    }

    return getPhaseLabel(job.phase);
}

function readCourseName() {
    const selectors = [
        "#page-header h1",
        ".page-context-header h1",
        "[data-region='page-header'] h1",
        ".page-header-headings h1",
        "header h1",
    ];

    for (const selector of selectors) {
        const text = document.querySelector(selector)?.textContent?.trim();
        if (text) {
            return text;
        }
    }

    return document.title.split("-")[0]?.trim() || "\uD55C\uC131 e-class";
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

async function copyText(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const input = document.createElement("input");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        const ok = document.execCommand("copy");
        input.remove();
        return ok;
    }
}
