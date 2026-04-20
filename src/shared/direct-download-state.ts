export const DIRECT_DOWNLOAD_STATE_KEY = "ecxDirectDownloadState";
export const MAX_RECENT_DIRECT_DOWNLOAD_JOBS = 12;

export type DirectDownloadPhase =
    | "queued"
    | "capturing"
    | "analyzing"
    | "downloading"
    | "saving"
    | "completed"
    | "failed";

export type DirectDownloadJobState = {
    id: string;
    viewerUrl: string;
    title: string;
    courseName: string;
    phase: DirectDownloadPhase;
    statusText: string;
    createdAt: number;
    updatedAt: number;
    queuePosition?: number;
    progressCurrent?: number;
    progressTotal?: number;
    progressPercent?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    finalBytes?: number;
    playlistUrl?: string;
    pageUrl?: string;
    resumableSessionId?: string;
    error?: string;
};

export type DirectDownloadStateSnapshot = {
    activeCount: number;
    updatedAt: number;
    jobs: DirectDownloadJobState[];
};

export function createEmptyDirectDownloadSnapshot(): DirectDownloadStateSnapshot {
    return {
        activeCount: 0,
        updatedAt: 0,
        jobs: [],
    };
}

export function isActiveJob(job: DirectDownloadJobState) {
    return job.phase !== "completed" && job.phase !== "failed";
}

export function getPhaseLabel(phase: DirectDownloadPhase) {
    switch (phase) {
        case "queued":
            return "\uB300\uAE30\uC911";
        case "capturing":
            return "\uCEA1\uCC98\uC911";
        case "analyzing":
            return "\uBD84\uC11D\uC911";
        case "downloading":
            return "\uB2E4\uC6B4\uB85C\uB4DC\uC911";
        case "saving":
            return "\uC800\uC7A5\uC911";
        case "completed":
            return "\uC644\uB8CC";
        case "failed":
            return "\uC2E4\uD328";
    }
}

export function getPhaseVariant(phase: DirectDownloadPhase) {
    switch (phase) {
        case "queued":
            return "secondary";
        case "capturing":
            return "info";
        case "analyzing":
            return "warning";
        case "downloading":
            return "primary";
        case "saving":
            return "warning";
        case "completed":
            return "success";
        case "failed":
            return "danger";
    }
}

export function getProgressPercent(job: DirectDownloadJobState) {
    if (typeof job.progressPercent === "number") {
        return clampPercent(job.progressPercent);
    }

    if (typeof job.progressCurrent === "number" && typeof job.progressTotal === "number" && job.progressTotal > 0) {
        return clampPercent((job.progressCurrent / job.progressTotal) * 100);
    }

    return isActiveJob(job) ? 0 : 100;
}

export function formatBytes(bytes?: number) {
    if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes < 0) {
        return "-";
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function pickViewerJob(jobs: DirectDownloadJobState[], viewerUrl: string) {
    const matches = jobs
        .filter(job => job.viewerUrl === viewerUrl)
        .sort((a, b) => {
            const activeDelta = Number(isActiveJob(b)) - Number(isActiveJob(a));
            if (activeDelta !== 0) {
                return activeDelta;
            }
            return b.updatedAt - a.updatedAt;
        });

    return matches[0] ?? null;
}

export function sortJobs(jobs: DirectDownloadJobState[]) {
    return [...jobs].sort((a, b) => {
        const activeDelta = Number(isActiveJob(b)) - Number(isActiveJob(a));
        if (activeDelta !== 0) {
            return activeDelta;
        }

        if (isActiveJob(a) && isActiveJob(b)) {
            const createdDelta = a.createdAt - b.createdAt;
            if (createdDelta !== 0) {
                return createdDelta;
            }
        } else {
            const updatedDelta = b.updatedAt - a.updatedAt;
            if (updatedDelta !== 0) {
                return updatedDelta;
            }
        }

        return a.id.localeCompare(b.id);
    });
}

function clampPercent(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
