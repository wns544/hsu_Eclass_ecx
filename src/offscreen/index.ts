import { deleteDownloadChunks, getDownloadChunks } from "#/shared/direct-download-store";

type OffscreenPrepareDownloadMessage = {
    type: "ECX_OFFSCREEN_START_DOWNLOAD";
    sessionId: string;
    mimeType: string;
    filename: string;
};

type OffscreenCleanupDownloadMessage = {
    type: "ECX_OFFSCREEN_CLEANUP_DOWNLOAD";
    sessionId: string;
};

const activeDownloads = new Map<string, string>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "ECX_OFFSCREEN_START_DOWNLOAD") {
        void handleStartDownload(message as OffscreenPrepareDownloadMessage)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to prepare download.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });
        return true;
    }

    if (message.type === "ECX_OFFSCREEN_CLEANUP_DOWNLOAD") {
        void handleCleanupDownload(message as OffscreenCleanupDownloadMessage)
            .then((result) => sendResponse(result))
            .catch((error) => {
                const text = error instanceof Error ? error.message : "Failed to clean up download.";
                sendResponse({
                    ok: false,
                    error: text,
                });
            });
        return true;
    }

    return;
});

async function handleStartDownload(message: OffscreenPrepareDownloadMessage) {
    const chunks = await getDownloadChunks(message.sessionId);
    if (chunks.length === 0) {
        throw new Error("No stored chunks were found.");
    }

    const file = new File(chunks, message.filename, {
        type: message.mimeType || "application/octet-stream",
    });
    if (file.size === 0) {
        throw new Error("Stored chunks produced an empty file.");
    }

    const previousUrl = activeDownloads.get(message.sessionId);
    if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
    }

    const url = URL.createObjectURL(file);
    activeDownloads.set(message.sessionId, url);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = message.filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    return {
        ok: true,
        objectUrl: url,
        size: file.size,
        chunkCount: chunks.length,
    };
}

async function handleCleanupDownload(message: OffscreenCleanupDownloadMessage) {
    const url = activeDownloads.get(message.sessionId);
    if (url) {
        URL.revokeObjectURL(url);
        activeDownloads.delete(message.sessionId);
    }

    await deleteDownloadChunks(message.sessionId);
    return {
        ok: true,
    };
}
