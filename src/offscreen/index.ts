import { deleteDownloadChunks, getDownloadChunks } from "#/shared/direct-download-store";

type OffscreenPrepareDownloadMessage = {
    type: "ECX_OFFSCREEN_PREPARE_DOWNLOAD";
    sessionId: string;
    mimeType: string;
};

type OffscreenCleanupDownloadMessage = {
    type: "ECX_OFFSCREEN_CLEANUP_DOWNLOAD";
    sessionId: string;
};

const activeDownloads = new Map<string, string>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "ECX_OFFSCREEN_PREPARE_DOWNLOAD") {
        void handlePrepareDownload(message as OffscreenPrepareDownloadMessage)
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

async function handlePrepareDownload(message: OffscreenPrepareDownloadMessage) {
    const chunks = await getDownloadChunks(message.sessionId);
    if (chunks.length === 0) {
        throw new Error("No stored chunks were found.");
    }

    const blob = new Blob(chunks, { type: message.mimeType || "application/octet-stream" });
    if (blob.size === 0) {
        throw new Error("Stored chunks produced an empty file.");
    }

    const previousUrl = activeDownloads.get(message.sessionId);
    if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
    }

    const url = URL.createObjectURL(blob);
    activeDownloads.set(message.sessionId, url);

    return {
        ok: true,
        objectUrl: url,
        size: blob.size,
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
