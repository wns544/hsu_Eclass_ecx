const params = new URLSearchParams(location.search);
const autoStart = params.get("ecxAutoStart") === "1";
const autoClose = params.get("ecxAutoClose") === "1";
const captureJobId = params.get("ecxCaptureJobId");

type DoneMessage = {
    type: "done";
    filename?: string;
    extension?: string;
    mimeType?: string;
    chunkCount?: number;
    totalBytes?: number;
};

if (params.get("ecxDirectDownload") === "1") {
    void startDirectDownloadFlow();
}

async function startDirectDownloadFlow() {
    const status = createStatus();
    const keepAlivePort = captureJobId
        ? chrome.runtime.connect({ name: "ECX_DIRECT_CAPTURE_KEEPALIVE" })
        : null;
    setStatus(
        status,
        autoStart
            ? "\uBC31\uADF8\uB77C\uC6B4\uB4DC \uB2E4\uC6B4\uB85C\uB4DC \uC900\uBE44 \uC911..."
            : "\uC7AC\uC0DD \uBC84\uD2BC\uC744 \uB204\uB974\uBA74 \uC9C1\uC811 \uB2E4\uC6B4\uB85C\uB4DC\uB97C \uC2DC\uB3C4\uD569\uB2C8\uB2E4.",
    );

    if (autoStart) {
        void autoStartPlayback(status);
    }

    const playlistUrl = await waitForPlaylist(status);
    if (!playlistUrl) {
        setStatus(status, "\uC2A4\uD2B8\uB9BC \uC8FC\uC18C\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        if (captureJobId) {
            await chrome.runtime.sendMessage({
                type: "DIRECT_DOWNLOAD_CAPTURE_FAILED",
                jobId: captureJobId,
                error: "Failed to capture playlist URL.",
            });
        }
        keepAlivePort?.disconnect();
        if (autoClose) {
            window.setTimeout(() => window.close(), 1500);
        }
        return;
    }

    if (captureJobId) {
        setStatus(status, "\uC2A4\uD2B8\uB9BC \uC8FC\uC18C \uD655\uC778. \uB2E4\uC6B4\uB85C\uB4DC \uC791\uC5C5\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4.");
        const res = await chrome.runtime.sendMessage({
            type: "CAPTURE_DIRECT_DOWNLOAD_STREAM",
            jobId: captureJobId,
            playlistUrl,
            pageUrl: location.href,
            filename: readTitle(),
        }) as { ok?: boolean, error?: string };

        if (!res?.ok) {
            setStatus(status, res?.error || "\uC2A4\uD2B8\uB9BC \uC778\uACC4 \uC2E4\uD328");
        } else {
            setStatus(status, "\uB2E4\uC6B4\uB85C\uB4DC \uB300\uAE30\uC5F4\uC5D0 \uCD94\uAC00\uB428");
        }

        keepAlivePort?.disconnect();
        if (autoClose) {
            window.setTimeout(() => window.close(), 1000);
        }
        return;
    }

    const port = chrome.runtime.connect({ name: "ECX_DIRECT_DOWNLOAD" });

    port.onMessage.addListener((message) => {
        if (message.type === "status") {
            setStatus(status, message.text);
        } else if (message.type === "done") {
            const done = message as DoneMessage;
            const size = done.totalBytes ? ` (${formatBytes(done.totalBytes)})` : "";
            setStatus(status, `\uB2E4\uC6B4\uB85C\uB4DC \uC2DC\uC791${size}`);
            port.disconnect();
            keepAlivePort?.disconnect();
            if (autoClose) {
                window.setTimeout(() => window.close(), 1000);
            }
        } else if (message.type === "error") {
            console.error("[ecx] direct download failed", message.text);
            setStatus(status, message.text);
            port.disconnect();
            keepAlivePort?.disconnect();
            if (autoClose) {
                window.setTimeout(() => window.close(), 2500);
            }
        }
    });

    port.postMessage({
        type: "DIRECT_DOWNLOAD_START",
        playlistUrl,
        filename: readTitle(),
        pageUrl: location.href,
        autoCloseTab: autoClose,
    });
}

async function waitForPlaylist(status: HTMLDivElement) {
    const existing = findStreamUrl();
    if (existing) {
        setStatus(status, "\uC2A4\uD2B8\uB9BC \uC8FC\uC18C \uD655\uC778\uB428. \uB2E4\uC6B4\uB85C\uB4DC \uC900\uBE44 \uC911...");
        return existing;
    }

    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
        const match = findStreamUrl();
        if (match) {
            setStatus(status, "\uC2A4\uD2B8\uB9BC \uC8FC\uC18C \uD655\uC778\uB428. \uB2E4\uC6B4\uB85C\uB4DC \uC900\uBE44 \uC911...");
            return match;
        }
        await delay(1000);
    }
    return null;
}

function createStatus() {
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.right = "16px";
    el.style.bottom = "16px";
    el.style.zIndex = "999999";
    el.style.maxWidth = "340px";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "10px";
    el.style.background = "rgba(17, 24, 39, 0.92)";
    el.style.color = "#fff";
    el.style.fontSize = "13px";
    el.style.lineHeight = "1.4";
    el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
    document.body.append(el);
    return el;
}

function setStatus(el: HTMLDivElement, text: string) {
    el.textContent = text;
}

function readTitle() {
    return document.title.split("-")[0].trim() || "video";
}

function sanitizeFilename(text: string) {
    return text.replace(/[\\/:*?\"<>|]/g, "_").slice(0, 120);
}

function formatBytes(bytes: number) {
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

async function autoStartPlayback(status: HTMLDivElement) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (findStreamUrl()) {
            return;
        }

        const started = await tryStartPlayback();
        if (started) {
            setStatus(status, "\uC790\uB3D9 \uC7AC\uC0DD \uC2DC\uB3C4 \uC911...");
        }

        await delay(1000);
    }
}

async function tryStartPlayback() {
    let interacted = false;

    const videos = [...document.querySelectorAll("video")] as HTMLVideoElement[];
    for (const video of videos) {
        try {
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.autoplay = true;
            const playPromise = video.play?.();
            if (playPromise) {
                await playPromise.catch(() => undefined);
            }
            interacted = true;
        } catch {
            // Ignore autoplay failures and keep trying other strategies.
        }
    }

    const selectors = [
        "button[aria-label*='\uC7AC\uC0DD']",
        "button[title*='\uC7AC\uC0DD']",
        "button[class*='play']",
        "div[class*='play']",
        ".vjs-big-play-button",
        "[role='button'][aria-label*='Play']",
        "[class*='play-button']",
    ];

    for (const selector of selectors) {
        const candidate = [...document.querySelectorAll<HTMLElement>(selector)]
            .find(isVisibleElement);
        if (!candidate) {
            continue;
        }

        candidate.click();
        interacted = true;
    }

    return interacted;
}

function findStreamUrl() {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const urls = entries.map(entry => entry.name).reverse();
    for (const url of urls) {
        if (isPlaylistUrl(url)) {
            return url;
        }
    }

    const videos = [...document.querySelectorAll("video")] as HTMLVideoElement[];
    for (const video of videos) {
        if (isPlaylistUrl(video.currentSrc)) {
            return video.currentSrc;
        }
        if (isPlaylistUrl(video.src)) {
            return video.src;
        }

        const sourceUrl = [...video.querySelectorAll("source")]
            .map(item => item.src)
            .find(isPlaylistUrl);
        if (sourceUrl) {
            return sourceUrl;
        }
    }

    return null;
}

function isPlaylistUrl(url: string | null | undefined): url is string {
    if (!url) {
        return false;
    }

    try {
        const parsed = new URL(url, location.href);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return false;
        }

        const lower = parsed.pathname.toLowerCase();
        return lower.includes(".m3u8");
    } catch {
        return false;
    }
}

function delay(ms: number) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function isVisibleElement(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0
        && rect.height > 0
        && window.getComputedStyle(el).visibility !== "hidden"
        && window.getComputedStyle(el).display !== "none";
}
