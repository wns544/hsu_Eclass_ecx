import "./sidepanel";
import muxjs from "mux.js";
import { deleteDownloadChunks, getDownloadChunkStats, putDownloadChunk } from "#/shared/direct-download-store";
import {
    DIRECT_DOWNLOAD_STATE_KEY,
    DirectDownloadJobState,
    DirectDownloadStateSnapshot,
    MAX_RECENT_DIRECT_DOWNLOAD_JOBS,
    isActiveJob,
    sortJobs,
} from "#/shared/direct-download-state";
import {
    DirectDownloadCaptureMode,
    DirectDownloadDetectionSource,
    DIRECT_DOWNLOAD_LOG_KEY,
    DirectDownloadLogEntry,
    DirectDownloadLogLevel,
    DirectDownloadLogSnapshot,
    MAX_DIRECT_DOWNLOAD_LOG_ENTRIES,
} from "#/shared/direct-download-log";

type DirectDownloadMessage = {
    type: "DIRECT_DOWNLOAD_START";
    playlistUrl: string;
    filename: string;
    pageUrl?: string;
    autoCloseTab?: boolean;
};

type StartDirectDownloadJobMessage = {
    type: "START_DIRECT_DOWNLOAD_JOB";
    viewerUrl: string;
    filename: string;
    courseName?: string;
};

type OpenDirectDownloadMonitorMessage = {
    type: "OPEN_DIRECT_DOWNLOAD_MONITOR";
    focus?: boolean;
};

type ExportDirectDownloadLogsMessage = {
    type: "EXPORT_DIRECT_DOWNLOAD_LOGS";
};

type ClearDirectDownloadLogsMessage = {
    type: "CLEAR_DIRECT_DOWNLOAD_LOGS";
};

type ResumeDirectDownloadJobMessage = {
    type: "RESUME_DIRECT_DOWNLOAD_JOB";
    jobId: string;
};

type CaptureDirectDownloadMessage = {
    type: "CAPTURE_DIRECT_DOWNLOAD_STREAM";
    jobId?: string;
    playlistUrl: string;
    pageUrl?: string;
    filename?: string;
    captureMode?: DirectDownloadCaptureMode;
    detectionSource?: DirectDownloadDetectionSource;
    autoplayAttempted?: boolean;
    autoplayInteracted?: boolean;
};

type CaptureDirectDownloadFailedMessage = {
    type: "DIRECT_DOWNLOAD_CAPTURE_FAILED";
    jobId?: string;
    error: string;
};

type FetchContext = {
    pageUrl?: string;
};

type MediaPlaylist = {
    url: string;
    entries: string[];
};

type MediaParts = {
    initSegmentUrl: string | null;
    segments: string[];
    container: "mp4" | "ts" | "bin";
    mimeType: string;
};

type TransmuxedSegment = {
    initSegment?: Uint8Array;
    data?: Uint8Array;
};

type MuxJsTransmuxer = {
    on(event: "data", listener: (segment: TransmuxedSegment) => void): void;
    on(event: "done", listener: () => void): void;
    push(data: Uint8Array): void;
    flush(): void;
};

type TransmuxSession = {
    transmuxer: MuxJsTransmuxer;
    pendingChunks: Uint8Array[];
    emittedInitSegment: boolean;
    emittedChunkCount: number;
    resolvePending: ((chunks: Uint8Array[]) => void) | null;
    rejectPending: ((reason?: unknown) => void) | null;
};

type DownloadStats = {
    chunkCount: number;
    totalBytes: number;
};

type OffscreenDownloadResult = {
    ok?: boolean;
    error?: string;
    size?: number;
    chunkCount?: number;
    objectUrl?: string;
};

type DirectDownloadTask = {
    playlistUrl: string;
    filename: string;
    pageUrl?: string;
    jobId?: string;
    resumeSessionId?: string;
};

type DirectDownloadResult = {
    filename: string;
    extension: string;
    mimeType: string;
    chunkCount: number;
    totalBytes: number;
};

type CaptureJob = {
    id: string;
    viewerUrl: string;
    filename: string;
    courseName: string;
    windowId?: number;
    tabId?: number;
};

type CachedPlaylistEntry = {
    viewerUrl: string;
    playlistUrl: string;
    pageUrl?: string;
    capturedAt: number;
};

type CachedPlaylistSnapshot = {
    entries: Record<string, CachedPlaylistEntry>;
};

const DIRECT_DOWNLOAD_MONITOR_PATH = "direct_downloads/index.html";
const DIRECT_DOWNLOAD_MONITOR_QUERY = `${chrome.runtime.getURL("direct_downloads/")}*`;
const DIRECT_DOWNLOAD_PLAYLIST_CACHE_KEY = "ecxDirectDownloadPlaylistCache";
const DIRECT_DOWNLOAD_PLAYLIST_CACHE_MAX_AGE = 120 * 24 * 60 * 60 * 1000;

let creatingOffscreenDocument: Promise<void> | null = null;
let activeCaptureJobId: string | null = null;
let stateFlushTimer: ReturnType<typeof setTimeout> | null = null;
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
let directDownloadMonitorTabId: number | null = null;

const activeDownloadCleanups = new Map<number, ReturnType<typeof setTimeout>>();
const captureJobQueue: string[] = [];
const captureJobs = new Map<string, CaptureJob>();
const captureJobTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const directDownloadJobs = new Map<string, DirectDownloadJobState>();
const directDownloadLogs: DirectDownloadLogEntry[] = [];
const downloadSessionLookup = new Map<number, string>();
const downloadJobLookup = new Map<number, string>();
const pendingDownloadLookup = new Map<string, { sessionId: string, jobId?: string }>();

void recoverPersistedDirectDownloadState();
void recoverPersistedDirectDownloadLogs();

chrome.downloads.onCreated.addListener((downloadItem) => {
    const pending = pendingDownloadLookup.get(downloadItem.url);
    if (!pending) {
        return;
    }

    pendingDownloadLookup.delete(downloadItem.url);
    trackOffscreenDownload(downloadItem.id, pending.sessionId, pending.jobId);
});

chrome.downloads.onChanged.addListener((delta) => {
    const state = delta.state?.current;
    const jobId = downloadJobLookup.get(delta.id);

    if (state === "complete" && jobId) {
        updateJobState(jobId, {
            phase: "completed",
            statusText: "\uD30C\uC77C \uC800\uC7A5 \uC644\uB8CC",
            progressPercent: 100,
        });
        logDirectDownloadEvent("info", "Chrome reported download complete.", jobId);
        downloadJobLookup.delete(delta.id);
    } else if (state === "interrupted" && jobId) {
        markJobFailed(
            jobId,
            delta.error?.current || "\uBE0C\uB77C\uC6B0\uC800 \uC800\uC7A5\uC774 \uC911\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
        );
        logDirectDownloadEvent(
            "error",
            `Chrome reported download interrupted${delta.error?.current ? `: ${delta.error.current}` : "."}`,
            jobId,
        );
        downloadJobLookup.delete(delta.id);
    }

    if (!state) {
        return;
    }

    const timeoutId = activeDownloadCleanups.get(delta.id);
    if (timeoutId === undefined) {
        return;
    }

    if (state !== "complete" && state !== "interrupted") {
        return;
    }

    clearTimeout(timeoutId);
    activeDownloadCleanups.delete(delta.id);
    const sessionId = downloadSessionLookup.get(delta.id) ?? null;
    downloadSessionLookup.delete(delta.id);
    void releaseOffscreenDownload(sessionId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (directDownloadMonitorTabId === tabId) {
        directDownloadMonitorTabId = null;
    }

    if (!activeCaptureJobId) {
        return;
    }

    const activeJob = captureJobs.get(activeCaptureJobId);
    if (!activeJob || activeJob.tabId !== tabId) {
        return;
    }

    void failCaptureJob(
        activeCaptureJobId,
        "\uCEA1\uCC98 \uD0ED\uC774 \uB2EB\uD600 \uC2A4\uD2B8\uB9BC \uD655\uC778\uC744 \uACC4\uC18D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
        tabId,
        false,
    );
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "ECX_DIRECT_CAPTURE_KEEPALIVE") {
        port.onDisconnect.addListener(() => undefined);
        return;
    }

    if (port.name !== "ECX_DIRECT_DOWNLOAD") {
        return;
    }

    const tabId = port.sender?.tab?.id;
    port.onMessage.addListener((message) => {
        if (message.type !== "DIRECT_DOWNLOAD_START") {
            return;
        }
        void startDirectDownload(port, message as DirectDownloadMessage, tabId);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "START_DIRECT_DOWNLOAD_JOB") {
        void startDirectDownloadJob(message as StartDirectDownloadJobMessage, sender)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to start direct download job.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });

        return true;
    }

    if (message.type === "OPEN_DIRECT_DOWNLOAD_MONITOR") {
        void ensureDirectDownloadMonitorTab(
            (message as OpenDirectDownloadMonitorMessage).focus === true,
            sender.tab?.windowId,
        ).then(() => {
            sendResponse({ ok: true });
        }).catch((error) => {
            const text = error instanceof Error ? error.message : "Failed to open monitor tab.";
            sendResponse({
                ok: false,
                error: text,
            });
        });

        return true;
    }

    if (message.type === "EXPORT_DIRECT_DOWNLOAD_LOGS") {
        void exportDirectDownloadLogs(message as ExportDirectDownloadLogsMessage)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to export direct-download logs.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });

        return true;
    }

    if (message.type === "CLEAR_DIRECT_DOWNLOAD_LOGS") {
        void clearDirectDownloadLogs(message as ClearDirectDownloadLogsMessage)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to clear direct-download logs.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });

        return true;
    }

    if (message.type === "RESUME_DIRECT_DOWNLOAD_JOB") {
        void resumeDirectDownloadJob(message as ResumeDirectDownloadJobMessage)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to resume direct download.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });

        return true;
    }

    if (message.type === "CAPTURE_DIRECT_DOWNLOAD_STREAM") {
        void handleCapturedDirectDownload(message as CaptureDirectDownloadMessage)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to capture stream URL.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });

        return true;
    }

    if (message.type === "DIRECT_DOWNLOAD_CAPTURE_FAILED") {
        void handleCaptureFailure(message as CaptureDirectDownloadFailedMessage, sender)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to handle capture failure.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });

        return true;
    }

    return;
});

async function startDirectDownload(port: chrome.runtime.Port, message: DirectDownloadMessage, tabId?: number) {
    try {
        const result = await executeDirectDownloadTask(message, (text) => {
            postStatus(port, text);
        });
        port.postMessage({
            type: "done",
            ...result,
        });
        await closeDownloadTab(tabId, message.autoCloseTab === true);
    } catch (error) {
        const text = error instanceof Error
            ? `\uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328: ${error.message}`
            : "\uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328";
        port.postMessage({
            type: "error",
            text,
        });
        await closeDownloadTab(tabId, message.autoCloseTab === true);
    }
}

async function executeDirectDownloadTask(task: DirectDownloadTask, onStatus?: (text: string) => void): Promise<DirectDownloadResult> {
    const { playlistUrl, filename, pageUrl, jobId, resumeSessionId } = task;
    const fetchContext: FetchContext = { pageUrl };
    const stats: DownloadStats = {
        chunkCount: 0,
        totalBytes: 0,
    };
    const sessionId = resumeSessionId || crypto.randomUUID();
    let preparedOffscreenDownload = false;

    const report = (patch: Partial<DirectDownloadJobState>) => {
        if (patch.statusText) {
            onStatus?.(patch.statusText);
        }
        if (jobId) {
            updateJobState(jobId, patch);
        }
    };

    try {
        if (!looksLikePlaylistUrl(playlistUrl)) {
            throw new Error("Playlist URL was not found. Please start playback and try again.");
        }

        logDirectDownloadEvent("info", "Playlist analysis started.", jobId);

        report({
            phase: "analyzing",
            statusText: "\uD50C\uB808\uC77C\uB9AC\uC2A4\uD2B8\uB97C \uBD84\uC11D\uD558\uB294 \uC911...",
            progressCurrent: undefined,
            progressTotal: undefined,
            progressPercent: undefined,
            downloadedBytes: undefined,
            totalBytes: undefined,
        });
        const mediaPlaylist = await resolvePlaylist(playlistUrl, fetchContext);
        const parts = parseMediaParts(mediaPlaylist);
        if (parts.segments.length === 0) {
            throw new Error("No segments found.");
        }
        logDirectDownloadEvent(
            "info",
            `Playlist resolved. segments=${parts.segments.length}${parts.initSegmentUrl ? ", init=yes" : ""}`,
            jobId,
        );

        const transmuxSession = parts.container === "ts"
            ? createTransmuxSession()
            : null;
        if (jobId && transmuxSession) {
            await cleanupStoredChunks(sessionId);
        }
        const totalParts = parts.segments.length + (parts.initSegmentUrl ? 1 : 0);
        const resumeStats = jobId && !transmuxSession
            ? await getDownloadChunkStats(sessionId)
            : { count: 0, totalBytes: 0 };
        let currentPart = Math.min(resumeStats.count, totalParts);
        stats.chunkCount = currentPart;
        stats.totalBytes = resumeStats.totalBytes;

        if (resumeStats.count > 0) {
            report({
                phase: "downloading",
                statusText: `\uC800\uC7A5\uB41C \uC870\uAC01 ${currentPart}\uAC1C\uB97C \uC774\uC5B4\uC11C \uC0AC\uC6A9\uD558\uB294 \uC911...`,
                progressCurrent: currentPart,
                progressTotal: totalParts,
                progressPercent: Math.round((currentPart / totalParts) * 100),
                downloadedBytes: stats.totalBytes,
                totalBytes: undefined,
            });
        }

        if (parts.initSegmentUrl && currentPart === 0) {
            const buffer = await fetchArrayBuffer(parts.initSegmentUrl, fetchContext);
            await storeChunk(stats, sessionId, new Uint8Array(buffer));
            currentPart += 1;
            report({
                phase: "downloading",
                statusText: `\uCD08\uAE30 \uBBF8\uB514\uC5B4 \uC815\uBCF4 \uB2E4\uC6B4\uB85C\uB4DC \uC911... (${currentPart}/${totalParts})`,
                progressCurrent: currentPart,
                progressTotal: totalParts,
                progressPercent: Math.round((currentPart / totalParts) * 100),
                downloadedBytes: stats.totalBytes,
            });
        }

        const completedSegments = Math.max(currentPart - (parts.initSegmentUrl ? 1 : 0), 0);
        for (let i = completedSegments; i < parts.segments.length; i += 1) {
            const buffer = await fetchArrayBuffer(parts.segments[i], fetchContext);
            if (transmuxSession) {
                const chunks = await transmuxTransportStreamSegment(transmuxSession, new Uint8Array(buffer));
                for (const chunk of chunks) {
                    await storeChunk(stats, sessionId, chunk);
                }
            } else {
                await storeChunk(stats, sessionId, new Uint8Array(buffer));
            }

            currentPart += 1;
            report({
                phase: "downloading",
                statusText: transmuxSession
                    ? `\uC601\uC0C1 \uB2E4\uC6B4\uB85C\uB4DC \uBC0F MP4 \uBCC0\uD658 \uC911... (${currentPart}/${totalParts})`
                    : `\uC601\uC0C1 \uB2E4\uC6B4\uB85C\uB4DC \uC911... (${currentPart}/${totalParts})`,
                progressCurrent: currentPart,
                progressTotal: totalParts,
                progressPercent: Math.round((currentPart / totalParts) * 100),
                downloadedBytes: stats.totalBytes,
            });
        }

        if (transmuxSession && transmuxSession.emittedChunkCount === 0) {
            throw new Error("TS stream was downloaded but MP4 remux produced no data.");
        }
        if (stats.totalBytes === 0) {
            throw new Error("No downloadable bytes were produced.");
        }

        const finalContainer = transmuxSession ? "mp4" : parts.container;
        const finalMimeType = transmuxSession ? "video/mp4" : parts.mimeType;
        logDirectDownloadEvent(
            "info",
            `Media download finished. container=${finalContainer}, bytes=${stats.totalBytes}`,
            jobId,
        );
        report({
            phase: "saving",
            statusText: "\uD30C\uC77C \uC800\uC7A5 \uC900\uBE44 \uC911...",
            progressCurrent: totalParts,
            progressTotal: totalParts,
            progressPercent: 100,
            downloadedBytes: stats.totalBytes,
            totalBytes: stats.totalBytes,
            finalBytes: stats.totalBytes,
        });
        const downloadResult = await prepareOffscreenDownload({
            sessionId,
            mimeType: finalMimeType,
            filename: `${sanitizeFilename(filename)}.${finalContainer}`,
        });
        preparedOffscreenDownload = true;
        if (!downloadResult.ok || !downloadResult.objectUrl) {
            throw new Error(downloadResult.error || "Failed to hand off file download.");
        }

        report({
            phase: "saving",
            statusText: "\uBE0C\uB77C\uC6B0\uC800 \uB2E4\uC6B4\uB85C\uB4DC \uBAA9\uB85D\uC5D0 \uB4F1\uB85D \uC911...",
            downloadedBytes: downloadResult.size ?? stats.totalBytes,
            totalBytes: downloadResult.size ?? stats.totalBytes,
            finalBytes: downloadResult.size ?? stats.totalBytes,
        });

        pendingDownloadLookup.set(downloadResult.objectUrl, {
            sessionId,
            jobId,
        });
        logDirectDownloadEvent("info", "Browser download started from offscreen document.", jobId);
        report({
            phase: "saving",
            statusText: "\uD06C\uB86C \uC800\uC7A5 \uCC98\uB9AC \uC911...",
            finalBytes: downloadResult.size ?? stats.totalBytes,
        });

        return {
            filename,
            extension: finalContainer,
            mimeType: finalMimeType,
            chunkCount: downloadResult.chunkCount ?? stats.chunkCount,
            totalBytes: downloadResult.size ?? stats.totalBytes,
        };
    } catch (error) {
        if (preparedOffscreenDownload) {
            await releaseOffscreenDownload(sessionId);
        } else if (!jobId) {
            await cleanupStoredChunks(sessionId);
        }
        if (jobId) {
            markJobFailed(jobId, error instanceof Error ? error.message : "\uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328", sessionId);
        }
        logDirectDownloadEvent(
            "error",
            error instanceof Error ? error.message : "Direct download failed.",
            jobId,
        );
        throw error;
    }
}

function postStatus(port: chrome.runtime.Port, text: string) {
    port.postMessage({
        type: "status",
        text,
    });
}

async function storeChunk(stats: DownloadStats, sessionId: string, chunk: Uint8Array) {
    stats.chunkCount += 1;
    stats.totalBytes += chunk.byteLength;
    await putDownloadChunk(sessionId, stats.chunkCount, new Blob([chunk], {
        type: "application/octet-stream",
    }));
}

async function resolvePlaylist(url: string, context: FetchContext, depth = 0): Promise<MediaPlaylist> {
    if (depth > 5) {
        throw new Error("Playlist nesting is too deep.");
    }

    const text = await fetchText(url, context);
    const lines = splitLines(text);
    const variants = parseVariants(lines, url);
    if (variants.length === 0) {
        return { url, entries: lines };
    }

    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return resolvePlaylist(variants[0].url, context, depth + 1);
}

function parseVariants(lines: string[], baseUrl: string) {
    const variants: { url: string, bandwidth: number }[] = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.startsWith("#EXT-X-STREAM-INF")) {
            continue;
        }
        const next = lines.slice(i + 1).find(item => item && !item.startsWith("#"));
        if (!next) {
            continue;
        }
        const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/)?.[1] ?? "0");
        variants.push({
            url: new URL(next, baseUrl).toString(),
            bandwidth,
        });
    }
    return variants;
}

function parseMediaParts(playlist: MediaPlaylist): MediaParts {
    const { entries, url } = playlist;
    const mapLine = entries.find(line => line.startsWith("#EXT-X-MAP:"));
    const keyLine = entries.find(line => line.startsWith("#EXT-X-KEY:"));
    if (keyLine && !keyLine.includes("METHOD=NONE")) {
        throw new Error("Encrypted HLS stream is not supported yet.");
    }

    const initSegmentUrl = mapLine ? extractAttributeUrl(mapLine, url) : null;
    const segments = entries
        .filter(line => !line.startsWith("#"))
        .map(line => new URL(line, url).toString());

    const extension = detectContainer(initSegmentUrl, segments);
    return {
        initSegmentUrl,
        segments,
        container: extension,
        mimeType: toMimeType(extension),
    };
}

function splitLines(text: string) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function extractAttributeUrl(line: string, baseUrl: string) {
    const matched = line.match(/URI="([^"]+)"/)?.[1];
    if (!matched) {
        throw new Error(`Failed to parse URI from ${line}`);
    }
    return new URL(matched, baseUrl).toString();
}

function detectContainer(initSegmentUrl: string | null, segments: string[]) {
    const sample = initSegmentUrl ?? segments[0] ?? "";
    const lower = sample.toLowerCase();
    if (lower.includes(".mp4") || lower.includes(".m4s") || lower.includes(".cmfv")) {
        return "mp4";
    }
    if (lower.includes(".ts")) {
        return "ts";
    }
    return "bin";
}

function toMimeType(container: MediaParts["container"]) {
    if (container === "mp4") {
        return "video/mp4";
    }
    if (container === "ts") {
        return "video/mp2t";
    }
    return "application/octet-stream";
}

function createTransmuxSession(): TransmuxSession {
    const transmuxer = new (muxjs.mp4.Transmuxer as new (options?: object) => MuxJsTransmuxer)({
        keepOriginalTimestamps: true,
    });

    const session: TransmuxSession = {
        transmuxer,
        pendingChunks: [],
        emittedInitSegment: false,
        emittedChunkCount: 0,
        resolvePending: null,
        rejectPending: null,
    };

    transmuxer.on("data", (segment) => {
        if (!session.emittedInitSegment && segment.initSegment?.byteLength) {
            session.pendingChunks.push(cloneBytes(segment.initSegment));
            session.emittedInitSegment = true;
        }

        if (segment.data?.byteLength) {
            session.pendingChunks.push(cloneBytes(segment.data));
        }
    });

    transmuxer.on("done", () => {
        const chunks = session.pendingChunks;
        session.pendingChunks = [];
        session.emittedChunkCount += chunks.length;
        session.resolvePending?.(chunks);
        session.resolvePending = null;
        session.rejectPending = null;
    });

    return session;
}

function transmuxTransportStreamSegment(session: TransmuxSession, input: Uint8Array) {
    if (session.resolvePending || session.rejectPending) {
        return Promise.reject(new Error("Previous remux operation is still running."));
    }

    session.pendingChunks = [];

    return new Promise<Uint8Array[]>((resolve, reject) => {
        session.resolvePending = resolve;
        session.rejectPending = reject;

        try {
            session.transmuxer.push(cloneBytes(input));
            session.transmuxer.flush();
        } catch (error) {
            session.resolvePending = null;
            session.rejectPending = null;
            reject(error);
        }
    });
}

function cloneBytes(bytes: Uint8Array) {
    return new Uint8Array(bytes);
}

async function fetchText(url: string, context: FetchContext) {
    const res = await fetchWithRetry(url, context);
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }
    return res.text();
}

async function fetchArrayBuffer(url: string, context: FetchContext) {
    const res = await fetchWithRetry(url, context);
    if (!res.ok) {
        throw new Error(`Failed to fetch segment ${url}: ${res.status}`);
    }
    return res.arrayBuffer();
}

async function fetchWithRetry(url: string, context: FetchContext, retries = 2) {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await fetch(url, buildFetchOptions(context));
        } catch (error) {
            lastError = error;
            if (attempt === retries) {
                break;
            }
        }
    }

    if (lastError instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${lastError.message}`);
    }
    throw new Error(`Failed to fetch ${url}`);
}

function buildFetchOptions(context: FetchContext): RequestInit {
    const options: RequestInit = {
        credentials: "include",
        cache: "no-store",
    };

    if (context.pageUrl) {
        options.referrer = context.pageUrl;
        options.referrerPolicy = "strict-origin-when-cross-origin";
    }

    return options;
}

function looksLikePlaylistUrl(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.pathname.toLowerCase().includes(".m3u8");
    } catch {
        return false;
    }
}

async function ensureOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL("offscreen.html");
    const runtimeWithContexts = chrome.runtime as typeof chrome.runtime & {
        getContexts?: (filter: {
            contextTypes?: string[];
            documentUrls?: string[];
        }) => Promise<{ contextType: string }[]>;
    };

    const contexts = runtimeWithContexts.getContexts
        ? await runtimeWithContexts.getContexts({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
            documentUrls: [offscreenUrl],
        })
        : [];

    if (contexts.length > 0) {
        return;
    }

    if (!creatingOffscreenDocument) {
        creatingOffscreenDocument = chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: [chrome.offscreen.Reason.BLOBS],
            justification: "Assemble direct-download media and save the resulting MP4 file.",
        }).finally(() => {
            creatingOffscreenDocument = null;
        });
    }

    await creatingOffscreenDocument;
}

async function prepareOffscreenDownload(message: {
    sessionId: string;
    mimeType: string;
    filename: string;
}) {
    await ensureOffscreenDocument();
    return chrome.runtime.sendMessage({
        type: "ECX_OFFSCREEN_START_DOWNLOAD",
        ...message,
    }) as Promise<OffscreenDownloadResult>;
}

async function releaseOffscreenDownload(sessionId: string | null) {
    if (!sessionId) {
        return;
    }

    try {
        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({
            type: "ECX_OFFSCREEN_CLEANUP_DOWNLOAD",
            sessionId,
        });
    } catch {
        await cleanupStoredChunks(sessionId);
    }
}

async function cleanupStoredChunks(sessionId: string) {
    try {
        await deleteDownloadChunks(sessionId);
    } catch {
        // Ignore cleanup failures during the experimental flow.
    }
}

async function cleanupJobChunks(job: DirectDownloadJobState) {
    if (!job.resumableSessionId) {
        return;
    }

    await cleanupStoredChunks(job.resumableSessionId);
}

function trackOffscreenDownload(downloadId: number, sessionId: string, jobId?: string) {
    const timeoutId = setTimeout(() => {
        activeDownloadCleanups.delete(downloadId);
        downloadSessionLookup.delete(downloadId);
        downloadJobLookup.delete(downloadId);
        void releaseOffscreenDownload(sessionId);
    }, 30 * 60_000);

    activeDownloadCleanups.set(downloadId, timeoutId);
    downloadSessionLookup.set(downloadId, sessionId);
    if (jobId) {
        downloadJobLookup.set(downloadId, jobId);
    }
}

function sanitizeFilename(text: string) {
    const normalized = normalizeTitle(text);
    return normalized.replace(/[\\/:*?\"<>|]/g, "_").slice(0, 120) || "video";
}

function normalizeTitle(text: string) {
    const normalized = text
        .replace(/(?:\s|[_\-\u2013\u2014()[\]])*\uB3D9\uC601\uC0C1\uCD9C\uC11D\s*$/u, "")
        .trim();
    return normalized || "video";
}

async function getCachedPlaylist(viewerUrl: string) {
    const key = normalizeViewerCacheKey(viewerUrl);
    const snapshot = await getPlaylistCacheSnapshot();
    const entry = snapshot.entries[key];
    if (!entry) {
        return null;
    }

    if (Date.now() - entry.capturedAt > DIRECT_DOWNLOAD_PLAYLIST_CACHE_MAX_AGE) {
        await deleteCachedPlaylist(viewerUrl);
        return null;
    }

    return entry;
}

async function setCachedPlaylist(viewerUrl: string, entry: CachedPlaylistEntry) {
    const snapshot = await getPlaylistCacheSnapshot();
    snapshot.entries[normalizeViewerCacheKey(viewerUrl)] = entry;
    await chrome.storage.local.set({
        [DIRECT_DOWNLOAD_PLAYLIST_CACHE_KEY]: snapshot,
    });
}

async function deleteCachedPlaylist(viewerUrl: string) {
    const snapshot = await getPlaylistCacheSnapshot();
    delete snapshot.entries[normalizeViewerCacheKey(viewerUrl)];
    await chrome.storage.local.set({
        [DIRECT_DOWNLOAD_PLAYLIST_CACHE_KEY]: snapshot,
    });
}

async function getPlaylistCacheSnapshot(): Promise<CachedPlaylistSnapshot> {
    const stored = await chrome.storage.local.get(DIRECT_DOWNLOAD_PLAYLIST_CACHE_KEY);
    const snapshot = stored[DIRECT_DOWNLOAD_PLAYLIST_CACHE_KEY] as CachedPlaylistSnapshot | undefined;
    return {
        entries: snapshot?.entries ?? {},
    };
}

function normalizeViewerCacheKey(viewerUrl: string) {
    try {
        const url = new URL(viewerUrl);
        for (const key of [...url.searchParams.keys()]) {
            if (key.startsWith("ecx")) {
                url.searchParams.delete(key);
            }
        }
        return `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
    } catch {
        return viewerUrl.trim();
    }
}

async function startDirectDownloadJob(message: StartDirectDownloadJobMessage, sender: chrome.runtime.MessageSender) {
    const jobId = crypto.randomUUID();
    const title = normalizeTitle(message.filename);
    const courseName = normalizeCourseName(message.courseName);
    const now = Date.now();

    directDownloadJobs.set(jobId, {
        id: jobId,
        viewerUrl: message.viewerUrl,
        title,
        courseName,
        phase: "queued",
        statusText: "\uB300\uAE30\uC5F4\uC5D0 \uCD94\uAC00\uB428",
        createdAt: now,
        updatedAt: now,
    });

    logDirectDownloadEvent("info", "Job queued for direct download.", jobId);
    refreshQueuePositions();
    scheduleStateFlush();
    void ensureDirectDownloadMonitorTab(false, sender.tab?.windowId);

    const cachedPlaylist = await getCachedPlaylist(message.viewerUrl);
    if (cachedPlaylist) {
        logDirectDownloadEvent("info", "Using cached playlist URL without opening viewer.", jobId);
        updateJobState(jobId, {
            phase: "analyzing",
            statusText: "\uC800\uC7A5\uB41C \uC2A4\uD2B8\uB9BC \uC8FC\uC18C\uB85C \uB2E4\uC6B4\uB85C\uB4DC \uC900\uBE44 \uC911...",
            playlistUrl: cachedPlaylist.playlistUrl,
            pageUrl: cachedPlaylist.pageUrl,
            resumableSessionId: jobId,
            queuePosition: undefined,
        });
        void executeDirectDownloadTask({
            playlistUrl: cachedPlaylist.playlistUrl,
            filename: title,
            pageUrl: cachedPlaylist.pageUrl,
            jobId,
            resumeSessionId: jobId,
        }).catch((error) => {
            console.error("[ecx] cached direct download failed", error);
            void deleteCachedPlaylist(message.viewerUrl);
        });

        return {
            ok: true,
            jobId,
            queued: false,
            cached: true,
            waiting: 0,
        };
    }

    captureJobs.set(jobId, {
        id: jobId,
        viewerUrl: message.viewerUrl,
        filename: title,
        courseName,
        windowId: sender.tab?.windowId,
    });
    captureJobQueue.push(jobId);
    await processCaptureQueue();

    return {
        ok: true,
        jobId,
        queued: true,
        waiting: captureJobQueue.length + (activeCaptureJobId ? 1 : 0) - (activeCaptureJobId === jobId ? 1 : 0),
    };
}

async function processCaptureQueue() {
    if (activeCaptureJobId || captureJobQueue.length === 0) {
        return;
    }

    const jobId = captureJobQueue.shift()!;
    const job = captureJobs.get(jobId);
    refreshQueuePositions();
    if (!job) {
        await processCaptureQueue();
        return;
    }

    activeCaptureJobId = jobId;
    logDirectDownloadEvent("info", "Capture phase started.", jobId);
    updateJobState(jobId, {
        phase: "capturing",
        statusText: "\uC228\uC740 \uC7AC\uC0DD \uD0ED\uC5D0\uC11C \uC2A4\uD2B8\uB9BC \uC8FC\uC18C\uB97C \uCEA1\uCC98\uD558\uB294 \uC911...",
        queuePosition: undefined,
        progressCurrent: undefined,
        progressTotal: undefined,
        progressPercent: undefined,
    });

    const url = new URL(job.viewerUrl);
    url.searchParams.set("ecxDirectDownload", "1");
    url.searchParams.set("ecxAutoStart", "1");
    url.searchParams.set("ecxAutoClose", "1");
    url.searchParams.set("ecxCaptureJobId", jobId);

    const createProperties: chrome.tabs.CreateProperties = {
        url: url.toString(),
        active: false,
    };
    if (job.windowId !== undefined) {
        createProperties.windowId = job.windowId;
    }

    try {
        const tab = await chrome.tabs.create(createProperties);
        job.tabId = tab.id;
        job.windowId = tab.windowId;

        updateJobState(jobId, {
            phase: "capturing",
            statusText: "\uC0C8 \uD0ED\uC5D0\uC11C \uC2A4\uD2B8\uB9BC \uC8FC\uC18C\uB97C \uD655\uC778\uD558\uB294 \uC911...",
        });
        logDirectDownloadEvent("info", `Capture tab opened${tab.id !== undefined ? ` (tabId=${tab.id})` : ""}.`, jobId);
    } catch (error) {
        await failCaptureJob(
            jobId,
            error instanceof Error ? error.message : "\uCEA1\uCC98 \uD0ED\uC744 \uC5F4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
        );
        return;
    }

    const timeoutId = setTimeout(() => {
        void failCaptureJob(jobId, "Timed out waiting for stream capture.");
    }, 45_000);
    captureJobTimeouts.set(jobId, timeoutId);
}

async function handleCapturedDirectDownload(message: CaptureDirectDownloadMessage) {
    if (!looksLikePlaylistUrl(message.playlistUrl)) {
        throw new Error("Playlist URL was not found.");
    }

    const job = message.jobId ? captureJobs.get(message.jobId) : null;
    const filename = job?.filename || normalizeTitle(message.filename || "video");
    if (message.jobId) {
        await completeCaptureJob(message.jobId);
        logDirectDownloadEvent(
            "info",
            buildCaptureSuccessMessage(message),
            message.jobId,
            {
                captureMode: message.captureMode,
                detectionSource: message.detectionSource,
            },
        );
        updateJobState(message.jobId, {
            phase: "analyzing",
            statusText: "\uC2A4\uD2B8\uB9BC \uCEA1\uCC98 \uC644\uB8CC. \uD50C\uB808\uC77C\uB9AC\uC2A4\uD2B8 \uBD84\uC11D \uC900\uBE44 \uC911...",
            playlistUrl: message.playlistUrl,
            pageUrl: message.pageUrl,
            resumableSessionId: message.jobId,
            error: undefined,
        });
        if (job) {
            await setCachedPlaylist(job.viewerUrl, {
                viewerUrl: job.viewerUrl,
                playlistUrl: message.playlistUrl,
                pageUrl: message.pageUrl,
                capturedAt: Date.now(),
            });
        }
        void executeDirectDownloadTask({
            playlistUrl: message.playlistUrl,
            filename,
            pageUrl: message.pageUrl,
            jobId: message.jobId,
            resumeSessionId: message.jobId,
        }).catch((error) => {
            console.error("[ecx] queued direct download failed", error);
        });
    } else {
        void executeDirectDownloadTask({
            playlistUrl: message.playlistUrl,
            filename,
            pageUrl: message.pageUrl,
        }).catch((error) => {
            console.error("[ecx] detached direct download failed", error);
        });
    }

    return {
        ok: true,
    };
}

function buildCaptureSuccessMessage(message: CaptureDirectDownloadMessage) {
    const source = message.detectionSource ? ` source=${message.detectionSource}` : "";

    switch (message.captureMode) {
        case "passive":
            return `Playlist capture succeeded without autoplay.${source}`;
        case "autoplay":
            return `Playlist capture succeeded after autoplay.${source}${message.autoplayInteracted ? ", interaction=yes" : ""}`;
        case "fallback_wait":
            return `Playlist capture succeeded after fallback wait.${source}${message.autoplayAttempted ? ", autoplayTried=yes" : ""}${message.autoplayInteracted ? ", interaction=yes" : ", interaction=no"}`;
        default:
            return `Playlist capture succeeded.${source}`;
    }
}

async function handleCaptureFailure(message: CaptureDirectDownloadFailedMessage, sender: chrome.runtime.MessageSender) {
    if (!message.jobId) {
        return {
            ok: true,
        };
    }

    await failCaptureJob(message.jobId, message.error, sender.tab?.id, false);
    return {
        ok: true,
    };
}

async function resumeDirectDownloadJob(message: ResumeDirectDownloadJobMessage) {
    const job = directDownloadJobs.get(message.jobId);
    if (!job) {
        throw new Error("Resume target was not found.");
    }
    if (isActiveJob(job)) {
        return {
            ok: true,
            alreadyActive: true,
        };
    }
    if (!job.playlistUrl) {
        throw new Error("This failed job has no captured stream URL. Please start the download again from the lecture list.");
    }

    updateJobState(job.id, {
        phase: "downloading",
        statusText: "\uC2E4\uD328\uD55C \uC9C1\uC811\uB2E4\uC6B4\uC744 \uC774\uC5B4\uBC1B\uB294 \uC911...",
        error: undefined,
        progressPercent: job.progressPercent ?? 0,
    });
    logDirectDownloadEvent("info", "Resume requested for failed direct download.", job.id);
    void executeDirectDownloadTask({
        playlistUrl: job.playlistUrl,
        filename: job.title,
        pageUrl: job.pageUrl,
        jobId: job.id,
        resumeSessionId: job.resumableSessionId || job.id,
    }).catch((error) => {
        console.error("[ecx] resumed direct download failed", error);
    });

    return {
        ok: true,
    };
}

async function completeCaptureJob(jobId: string) {
    clearCaptureJobTimer(jobId);
    activeCaptureJobId = activeCaptureJobId === jobId ? null : activeCaptureJobId;
    captureJobs.delete(jobId);
    refreshQueuePositions();
    scheduleNextCapture(800);
}

async function failCaptureJob(jobId: string, reason: string, tabId?: number, closeTab = true) {
    clearCaptureJobTimer(jobId);
    activeCaptureJobId = activeCaptureJobId === jobId ? null : activeCaptureJobId;
    const job = captureJobs.get(jobId);
    captureJobs.delete(jobId);
    refreshQueuePositions();
    markJobFailed(jobId, reason);
    logDirectDownloadEvent("error", `Capture failed: ${reason}`, jobId);
    if (closeTab) {
        await closeDownloadTab(tabId ?? job?.tabId, true);
    }
    console.error("[ecx] direct download capture failed", reason);
    scheduleNextCapture(closeTab ? 300 : 1200);
}

function clearCaptureJobTimer(jobId: string) {
    const timeoutId = captureJobTimeouts.get(jobId);
    if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        captureJobTimeouts.delete(jobId);
    }
}

function scheduleNextCapture(delayMs: number) {
    setTimeout(() => {
        void processCaptureQueue();
    }, delayMs);
}

async function closeDownloadTab(tabId: number | undefined, enabled: boolean) {
    if (!enabled || tabId === undefined) {
        return;
    }

    try {
        await chrome.tabs.remove(tabId);
    } catch {
        // Ignore tab cleanup failures for the experimental download flow.
    }
}

function normalizeCourseName(text?: string) {
    const trimmed = text?.trim();
    return trimmed || "\uD55C\uC131 e-class";
}

function updateJobState(jobId: string, patch: Partial<DirectDownloadJobState>) {
    const current = directDownloadJobs.get(jobId);
    if (!current) {
        return;
    }

    Object.assign(current, patch, {
        updatedAt: Date.now(),
    });

    if (current.phase !== "queued") {
        delete current.queuePosition;
    }

    scheduleStateFlush();
}

function markJobFailed(jobId: string, reason: string, resumableSessionId?: string) {
    const current = directDownloadJobs.get(jobId);
    if (!current) {
        return;
    }

    updateJobState(jobId, {
        phase: "failed",
        statusText: "\uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328",
        error: reason,
        resumableSessionId: resumableSessionId ?? current.resumableSessionId,
    });
}

function refreshQueuePositions() {
    const now = Date.now();

    for (const job of directDownloadJobs.values()) {
        if (job.phase === "queued") {
            delete job.queuePosition;
            job.updatedAt = now;
        }
    }

    captureJobQueue.forEach((jobId, index) => {
        const job = directDownloadJobs.get(jobId);
        if (!job) {
            return;
        }
        job.queuePosition = index + 1;
        job.updatedAt = now;
    });

    if (activeCaptureJobId) {
        const activeJob = directDownloadJobs.get(activeCaptureJobId);
        if (activeJob) {
            delete activeJob.queuePosition;
            activeJob.updatedAt = now;
        }
    }

    scheduleStateFlush();
}

function scheduleStateFlush() {
    if (stateFlushTimer) {
        return;
    }

    stateFlushTimer = setTimeout(() => {
        stateFlushTimer = null;
        void flushDirectDownloadState();
    }, 120);
}

async function flushDirectDownloadState() {
    pruneDirectDownloadHistory();

    const jobs = sortJobs([...directDownloadJobs.values()]);
    const snapshot: DirectDownloadStateSnapshot = {
        activeCount: jobs.filter(isActiveJob).length,
        updatedAt: Date.now(),
        jobs,
    };

    await chrome.storage.local.set({
        [DIRECT_DOWNLOAD_STATE_KEY]: snapshot,
    });
    await updateActionBadge(snapshot.activeCount);
}

function pruneDirectDownloadHistory() {
    const activeIds = sortJobs([...directDownloadJobs.values()].filter(isActiveJob)).map(job => job.id);
    const recentInactiveIds = sortJobs([...directDownloadJobs.values()].filter(job => !isActiveJob(job)))
        .slice(0, MAX_RECENT_DIRECT_DOWNLOAD_JOBS)
        .map(job => job.id);
    const keepIds = new Set([...activeIds, ...recentInactiveIds]);

    for (const jobId of [...directDownloadJobs.keys()]) {
        if (!keepIds.has(jobId)) {
            directDownloadJobs.delete(jobId);
        }
    }
}

async function updateActionBadge(activeCount: number) {
    await chrome.action.setBadgeBackgroundColor({
        color: activeCount > 0 ? "#0f6fa8" : "#9aa7b8",
    });
    await chrome.action.setBadgeText({
        text: activeCount > 0 ? String(Math.min(activeCount, 99)) : "",
    });
    await chrome.action.setTitle({
        title: activeCount > 0
            ? `hsu-ecx (\uC9C1\uC811\uB2E4\uC6B4 ${activeCount}\uAC74 \uC9C4\uD589 \uC911)`
            : "hsu-ecx",
    });
}

async function recoverPersistedDirectDownloadState() {
    const stored = await chrome.storage.local.get(DIRECT_DOWNLOAD_STATE_KEY);
    const snapshot = stored[DIRECT_DOWNLOAD_STATE_KEY] as DirectDownloadStateSnapshot | undefined;
        if (!snapshot?.jobs?.length) {
        await updateActionBadge(0);
        return;
    }

    const interruptedAt = Date.now();
    for (const job of snapshot.jobs) {
        if (directDownloadJobs.has(job.id)) {
            continue;
        }

        if (isActiveJob(job) && job.resumableSessionId) {
            directDownloadJobs.set(job.id, {
                ...job,
                phase: "failed",
                statusText: "\uD655\uC7A5 \uD504\uB85C\uADF8\uB7A8\uC774 \uB2E4\uC2DC \uC2DC\uC791\uB418\uC5B4 \uC791\uC5C5\uC774 \uC911\uB2E8\uB428",
                error: "\uD655\uC7A5 \uD504\uB85C\uADF8\uB7A8 \uC7AC\uC2DC\uC791. \uC774\uC5B4\uBC1B\uAE30\uB97C \uB204\uB974\uBA74 \uC800\uC7A5\uB41C \uC870\uAC01\uC744 \uC0AC\uC6A9\uD569\uB2C8\uB2E4.",
                updatedAt: interruptedAt,
            });
        } else {
            directDownloadJobs.set(job.id, isActiveJob(job)
                ? {
                    ...job,
                    phase: "failed",
                    statusText: "\uD655\uC7A5 \uD504\uB85C\uADF8\uB7A8\uC774 \uB2E4\uC2DC \uC2DC\uC791\uB418\uC5B4 \uC791\uC5C5\uC774 \uC911\uB2E8\uB428",
                    error: "\uD655\uC7A5 \uD504\uB85C\uADF8\uB7A8 \uC7AC\uC2DC\uC791",
                    updatedAt: interruptedAt,
                }
                : job);
        }
    }

    await flushDirectDownloadState();
}

async function recoverPersistedDirectDownloadLogs() {
    const stored = await chrome.storage.local.get(DIRECT_DOWNLOAD_LOG_KEY);
    const snapshot = stored[DIRECT_DOWNLOAD_LOG_KEY] as DirectDownloadLogSnapshot | undefined;
    if (!snapshot?.entries?.length) {
        return;
    }

    directDownloadLogs.splice(0, directDownloadLogs.length, ...snapshot.entries);
}

function logDirectDownloadEvent(
    level: DirectDownloadLogLevel,
    message: string,
    jobId?: string,
    details?: {
        captureMode?: DirectDownloadCaptureMode;
        detectionSource?: DirectDownloadDetectionSource;
    },
) {
    const job = jobId ? directDownloadJobs.get(jobId) : null;

    directDownloadLogs.push({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        level,
        message,
        jobId,
        title: job?.title,
        courseName: job?.courseName,
        phase: job?.phase,
        captureMode: details?.captureMode,
        detectionSource: details?.detectionSource,
    });

    if (directDownloadLogs.length > MAX_DIRECT_DOWNLOAD_LOG_ENTRIES) {
        directDownloadLogs.splice(0, directDownloadLogs.length - MAX_DIRECT_DOWNLOAD_LOG_ENTRIES);
    }

    scheduleLogFlush();
}

function scheduleLogFlush() {
    if (logFlushTimer) {
        return;
    }

    logFlushTimer = setTimeout(() => {
        logFlushTimer = null;
        void flushDirectDownloadLogs();
    }, 200);
}

async function flushDirectDownloadLogs() {
    const snapshot: DirectDownloadLogSnapshot = {
        updatedAt: Date.now(),
        entries: [...directDownloadLogs],
    };

    await chrome.storage.local.set({
        [DIRECT_DOWNLOAD_LOG_KEY]: snapshot,
    });
}

async function exportDirectDownloadLogs(_message: ExportDirectDownloadLogsMessage) {
    const text = buildDirectDownloadLogText();
    if (!text.trim()) {
        throw new Error("No direct-download logs are available yet.");
    }

    const stamp = formatExportStamp(new Date());
    const downloadId = await chrome.downloads.download({
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
        filename: `hsu-ecx-direct-download-log-${stamp}.txt`,
        saveAs: false,
    });

    if (downloadId === undefined) {
        throw new Error("Download API did not return a download id.");
    }

    return {
        ok: true,
        downloadId,
    };
}

async function clearDirectDownloadLogs(_message: ClearDirectDownloadLogsMessage) {
    directDownloadLogs.splice(0, directDownloadLogs.length);
    await flushDirectDownloadLogs();

    return {
        ok: true,
        cleared: true,
    };
}

function buildDirectDownloadLogText() {
    const lines = [
        "hsu-ecx direct download logs",
        `generatedAt=${new Date().toISOString()}`,
        `entries=${directDownloadLogs.length}`,
        "",
    ];

    for (const entry of directDownloadLogs) {
        const parts = [
            new Date(entry.timestamp).toISOString(),
            entry.level.toUpperCase(),
        ];

        if (entry.courseName) {
            parts.push(entry.courseName);
        }
        if (entry.title) {
            parts.push(entry.title);
        }
        if (entry.jobId) {
            parts.push(`job=${entry.jobId}`);
        }
        if (entry.phase) {
            parts.push(`phase=${entry.phase}`);
        }
        if (entry.captureMode) {
            parts.push(`capture=${entry.captureMode}`);
        }
        if (entry.detectionSource) {
            parts.push(`source=${entry.detectionSource}`);
        }

        lines.push(`[${parts.join(" | ")}] ${entry.message}`);
    }

    return lines.join("\r\n");
}

function formatExportStamp(date: Date) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function ensureDirectDownloadMonitorTab(focus: boolean, preferredWindowId?: number) {
    if (directDownloadMonitorTabId !== null) {
        try {
            const existingTab = await chrome.tabs.get(directDownloadMonitorTabId);
            if (focus) {
                await focusTab(existingTab);
            }
            return existingTab;
        } catch {
            directDownloadMonitorTabId = null;
        }
    }

    const existingTabs = await chrome.tabs.query({
        url: DIRECT_DOWNLOAD_MONITOR_QUERY,
    });
    const existing = existingTabs[0];
    if (existing?.id !== undefined) {
        directDownloadMonitorTabId = existing.id;
        if (focus) {
            await focusTab(existing);
        }
        return existing;
    }

    const createProperties: chrome.tabs.CreateProperties = {
        url: chrome.runtime.getURL(DIRECT_DOWNLOAD_MONITOR_PATH),
        active: focus,
    };
    if (!focus && preferredWindowId !== undefined) {
        createProperties.windowId = preferredWindowId;
    }

    try {
        const tab = await chrome.tabs.create(createProperties);
        directDownloadMonitorTabId = tab.id ?? null;
        return tab;
    } catch {
        const tab = await chrome.tabs.create({
            url: chrome.runtime.getURL(DIRECT_DOWNLOAD_MONITOR_PATH),
            active: focus,
        });
        directDownloadMonitorTabId = tab.id ?? null;
        return tab;
    }
}

async function focusTab(tab: chrome.tabs.Tab) {
    if (typeof tab.windowId === "number") {
        await chrome.windows.update(tab.windowId, {
            focused: true,
        });
    }

    if (typeof tab.id === "number") {
        await chrome.tabs.update(tab.id, {
            active: true,
        });
    }
}
