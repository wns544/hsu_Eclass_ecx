import { DirectDownloadPhase } from "#/shared/direct-download-state";

export const DIRECT_DOWNLOAD_LOG_KEY = "ecxDirectDownloadLogs";
export const MAX_DIRECT_DOWNLOAD_LOG_ENTRIES = 250;

export type DirectDownloadLogLevel = "info" | "warn" | "error";
export type DirectDownloadCaptureMode = "passive" | "autoplay" | "fallback_wait";
export type DirectDownloadDetectionSource = "hinted" | "document" | "resource" | "video";

export type DirectDownloadLogEntry = {
    id: string;
    timestamp: number;
    level: DirectDownloadLogLevel;
    message: string;
    jobId?: string;
    title?: string;
    courseName?: string;
    phase?: DirectDownloadPhase;
    captureMode?: DirectDownloadCaptureMode;
    detectionSource?: DirectDownloadDetectionSource;
};

export type DirectDownloadLogSnapshot = {
    updatedAt: number;
    entries: DirectDownloadLogEntry[];
};

export function createEmptyDirectDownloadLogSnapshot(): DirectDownloadLogSnapshot {
    return {
        updatedAt: 0,
        entries: [],
    };
}

export function sortLogs(entries: DirectDownloadLogEntry[]) {
    return [...entries].sort((a, b) => b.timestamp - a.timestamp);
}

export function formatLogTimestamp(timestamp: number) {
    if (!timestamp) {
        return "-";
    }

    return new Intl.DateTimeFormat("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(timestamp);
}

export function getLogLevelLabel(level: DirectDownloadLogLevel) {
    switch (level) {
        case "info":
            return "INFO";
        case "warn":
            return "WARN";
        case "error":
            return "ERROR";
    }
}

export function getCaptureModeLabel(mode: DirectDownloadCaptureMode) {
    switch (mode) {
        case "passive":
            return "무재생 캡처";
        case "autoplay":
            return "자동재생 후 캡처";
        case "fallback_wait":
            return "지연 감지 캡처";
    }
}

export function getDetectionSourceLabel(source: DirectDownloadDetectionSource) {
    switch (source) {
        case "hinted":
            return "힌트";
        case "document":
            return "문서";
        case "resource":
            return "네트워크";
        case "video":
            return "비디오 태그";
    }
}
