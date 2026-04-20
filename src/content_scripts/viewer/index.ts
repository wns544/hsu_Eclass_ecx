const params = new URLSearchParams(location.search);
const autoStart = params.get("ecxAutoStart") === "1";
const autoClose = params.get("ecxAutoClose") === "1";
const captureJobId = params.get("ecxCaptureJobId");
const hintedPlaylistUrls: string[] = [];
const hintedPlaylistUrlSet = new Set<string>();
const VIEWER_LINK_SELECTOR = [
    "a[href*='/mod/vod/viewer.php?id=']",
    "a[href*='/mod/vod/view.php?id=']",
    "a[href*='/mod/laby/viewer.php?i=']",
].join(", ");

type DoneMessage = {
    type: "done";
    filename?: string;
    extension?: string;
    mimeType?: string;
    chunkCount?: number;
    totalBytes?: number;
};

type PlaylistDetectionSource = "hinted" | "document" | "resource" | "video";

type PlaylistCaptureMode = "passive" | "autoplay" | "fallback_wait";

type PlaylistDetection = {
    url: string;
    source: PlaylistDetectionSource;
};

type PlaylistCaptureResult = {
    playlistUrl: string;
    captureMode: PlaylistCaptureMode;
    detectionSource: PlaylistDetectionSource;
    autoplayAttempted: boolean;
    autoplayInteracted: boolean;
};

installPassiveCaptureHooks();
void installViewerLectureDedupe();

if (params.get("ecxDirectDownload") === "1") {
    void startDirectDownloadFlow();
}

async function startDirectDownloadFlow() {
    await waitForDocumentBody();
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

    const capture = await waitForPlaylist(status);
    if (!capture) {
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
            playlistUrl: capture.playlistUrl,
            pageUrl: location.href,
            filename: readTitle(),
            captureMode: capture.captureMode,
            detectionSource: capture.detectionSource,
            autoplayAttempted: capture.autoplayAttempted,
            autoplayInteracted: capture.autoplayInteracted,
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
        playlistUrl: capture.playlistUrl,
        filename: readTitle(),
        pageUrl: location.href,
        autoCloseTab: autoClose,
    });
}

async function waitForPlaylist(status: HTMLDivElement): Promise<PlaylistCaptureResult | null> {
    const existing = findStreamUrl();
    if (existing) {
        setStatus(status, "\uC2A4\uD2B8\uB9BC \uC8FC\uC18C \uD655\uC778\uB428. \uB2E4\uC6B4\uB85C\uB4DC \uC900\uBE44 \uC911...");
        return {
            playlistUrl: existing.url,
            captureMode: "passive",
            detectionSource: existing.source,
            autoplayAttempted: false,
            autoplayInteracted: false,
        };
    }

    setStatus(status, "\uC7AC\uC0DD \uC2DC\uB3C4 \uC5C6\uC774 \uC2A4\uD2B8\uB9BC \uC8FC\uC18C\uB97C \uCC3E\uB294 \uC911...");
    const passiveDeadline = Date.now() + (autoStart ? 5000 : 10 * 60_000);
    while (Date.now() < passiveDeadline) {
        const match = findStreamUrl();
        if (match) {
            setStatus(status, "\uC2A4\uD2B8\uB9BC \uC8FC\uC18C \uD655\uC778\uB428. \uB2E4\uC6B4\uB85C\uB4DC \uC900\uBE44 \uC911...");
            return {
                playlistUrl: match.url,
                captureMode: "passive",
                detectionSource: match.source,
                autoplayAttempted: false,
                autoplayInteracted: false,
            };
        }
        await delay(500);
    }

    if (!autoStart) {
        return null;
    }

    setStatus(status, "\uBB34\uC7AC\uC0DD \uD655\uC778\uC740 \uC2E4\uD328. \uC790\uB3D9 \uC7AC\uC0DD\uB85C \uB2E4\uC2DC \uC2DC\uB3C4 \uC911...");
    const playbackResult = await autoStartPlayback(status);

    const match = findStreamUrl();
    if (match) {
        setStatus(status, "\uC2A4\uD2B8\uB9BC \uC8FC\uC18C \uD655\uC778\uB428. \uB2E4\uC6B4\uB85C\uB4DC \uC900\uBE44 \uC911...");
        return {
            playlistUrl: match.url,
            captureMode: playbackResult.interacted ? "autoplay" : "fallback_wait",
            detectionSource: match.source,
            autoplayAttempted: playbackResult.attempted,
            autoplayInteracted: playbackResult.interacted,
        };
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
    let attempted = false;
    let interacted = false;
    while (Date.now() < deadline) {
        if (findStreamUrl()) {
            return { attempted, interacted };
        }

        const started = await tryStartPlayback();
        if (started) {
            attempted = true;
            interacted = true;
            setStatus(status, "\uC790\uB3D9 \uC7AC\uC0DD \uC2DC\uB3C4 \uC911...");
        }

        await delay(1000);
    }

    return { attempted, interacted };
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

function findStreamUrl(): PlaylistDetection | null {
    const hinted = findHintedPlaylistUrl();
    if (hinted) {
        return {
            url: hinted,
            source: "hinted",
        };
    }

    const fromDocument = findDocumentPlaylistUrl();
    if (fromDocument) {
        rememberPlaylistUrl(fromDocument);
        return {
            url: fromDocument,
            source: "document",
        };
    }

    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const urls = entries.map(entry => entry.name).reverse();
    for (const url of urls) {
        if (isPlaylistUrl(url)) {
            rememberPlaylistUrl(url);
            return {
                url,
                source: "resource",
            };
        }
    }

    const videos = [...document.querySelectorAll("video")] as HTMLVideoElement[];
    for (const video of videos) {
        if (isPlaylistUrl(video.currentSrc)) {
            rememberPlaylistUrl(video.currentSrc);
            return {
                url: video.currentSrc,
                source: "video",
            };
        }
        if (isPlaylistUrl(video.src)) {
            rememberPlaylistUrl(video.src);
            return {
                url: video.src,
                source: "video",
            };
        }

        const sourceUrl = [...video.querySelectorAll("source")]
            .map(item => item.src)
            .find(isPlaylistUrl);
        if (sourceUrl) {
            rememberPlaylistUrl(sourceUrl);
            return {
                url: sourceUrl,
                source: "video",
            };
        }
    }

    return null;
}

function installPassiveCaptureHooks() {
    try {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                rememberPlaylistUrl(entry.name);
            }
        });
        observer.observe({
            entryTypes: ["resource"],
        });
    } catch {
        // Ignore observer setup failures and rely on polling.
    }
}

function findHintedPlaylistUrl() {
    return hintedPlaylistUrls.at(-1) ?? null;
}

function rememberPlaylistUrl(url: string) {
    if (!isPlaylistUrl(url)) {
        return;
    }

    const normalized = new URL(url, location.href).toString();
    if (hintedPlaylistUrlSet.has(normalized)) {
        return;
    }

    hintedPlaylistUrlSet.add(normalized);
    hintedPlaylistUrls.push(normalized);
}

function findDocumentPlaylistUrl() {
    for (const selector of ["video", "source", "iframe", "[src]", "[href]", "[data-src]"]) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
            const candidate = element.getAttribute("src")
                || element.getAttribute("href")
                || element.getAttribute("data-src")
                || "";
            if (isPlaylistUrl(candidate)) {
                return new URL(candidate, location.href).toString();
            }
        }
    }

    for (const script of document.querySelectorAll("script")) {
        const text = script.textContent;
        const matched = text ? extractPlaylistUrl(text) : null;
        if (matched) {
            return matched;
        }
    }

    return null;
}

function extractPlaylistUrl(text: string) {
    if (!text.includes(".m3u8")) {
        return null;
    }

    const normalized = text
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/");
    const patterns = [
        /https?:\/\/[^\s"'`<>\\]+\.m3u8[^\s"'`<>\\]*/ig,
        /(?:\/|\.\.?\/)[^\s"'`<>\\]+\.m3u8[^\s"'`<>\\]*/ig,
    ];

    for (const pattern of patterns) {
        const matched = normalized.match(pattern);
        if (!matched) {
            continue;
        }

        const found = matched.find(candidate => isPlaylistUrl(candidate));
        if (found) {
            return new URL(found, location.href).toString();
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

async function waitForDocumentBody() {
    if (document.body) {
        return;
    }

    await new Promise<void>((resolve) => {
        const onReady = () => {
            if (!document.body) {
                return;
            }
            document.removeEventListener("readystatechange", onReady);
            resolve();
        };

        document.addEventListener("readystatechange", onReady);
        onReady();
    });
}

function isVisibleElement(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0
        && rect.height > 0
        && window.getComputedStyle(el).visibility !== "hidden"
        && window.getComputedStyle(el).display !== "none";
}

async function installViewerLectureDedupe() {
    await waitForDocumentBody();
    dedupeViewerLectureLists();

    const observer = new MutationObserver(() => {
        dedupeViewerLectureLists();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

function dedupeViewerLectureLists() {
    const links = [...document.querySelectorAll<HTMLAnchorElement>(VIEWER_LINK_SELECTOR)];
    const rows = new Set<HTMLElement>();

    for (const link of links) {
        const row = findLectureListRow(link);
        if (row) {
            rows.add(row);
        }
    }

    dedupeLectureRows([...rows]);
}

function findLectureListRow(link: HTMLAnchorElement) {
    let current = link.parentElement;
    let row = current;

    while (current?.parentElement && current.parentElement !== document.body) {
        const parent = current.parentElement;
        const viewerLinks = parent.querySelectorAll(VIEWER_LINK_SELECTOR);
        if (viewerLinks.length >= 2) {
            return row;
        }

        row = parent;
        current = parent;
    }

    return row;
}

function dedupeLectureRows(rows: HTMLElement[]) {
    const seen = new Set<string>();

    for (const row of rows) {
        const link = row.querySelector<HTMLAnchorElement>(VIEWER_LINK_SELECTOR);
        if (!link) {
            continue;
        }

        const key = buildLectureRowKey(row, link);
        if (!key) {
            continue;
        }

        if (seen.has(key)) {
            row.style.display = "none";
            row.dataset.ecxLectureDeduped = "true";
            continue;
        }

        seen.add(key);
        row.style.removeProperty("display");
        row.dataset.ecxLectureDeduped = "false";
    }
}

function buildLectureRowKey(row: HTMLElement, link: HTMLAnchorElement) {
    const href = normalizeHref(link.href);
    const title = normalizeText(link.textContent);
    const duration = normalizeText(row.textContent?.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0]);

    if (title && duration) {
        return `title:${title}::duration:${duration}`;
    }

    if (title) {
        return `title:${title}`;
    }

    if (!href) {
        return "";
    }

    return `href:${href}`;
}

function normalizeHref(href: string | null | undefined) {
    if (!href) {
        return "";
    }

    try {
        const url = new URL(href, location.href);
        return `${url.pathname}?${url.searchParams.toString()}`;
    } catch {
        return href.trim();
    }
}

function normalizeText(text: string | null | undefined) {
    return text?.replace(/\s+/g, " ").trim() ?? "";
}
