const DB_NAME = "ecx-direct-download";
const DB_VERSION = 1;
const CHUNK_STORE = "chunks";

type DownloadChunkRecord = {
    sessionId: string;
    index: number;
    blob: Blob;
};

export async function putDownloadChunk(sessionId: string, index: number, blob: Blob) {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CHUNK_STORE, "readwrite");
        tx.objectStore(CHUNK_STORE).put({
            sessionId,
            index,
            blob,
        } satisfies DownloadChunkRecord);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error ?? new Error("Failed to store chunk."));
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error ?? new Error("Chunk storage aborted."));
        };
    });
}

export async function getDownloadChunks(sessionId: string) {
    const db = await openDatabase();
    return new Promise<Blob[]>((resolve, reject) => {
        const tx = db.transaction(CHUNK_STORE, "readonly");
        const store = tx.objectStore(CHUNK_STORE);
        const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
        const req = store.getAll(range);
        req.onsuccess = () => {
            const rows = (req.result as DownloadChunkRecord[]).sort((a, b) => a.index - b.index);
            db.close();
            resolve(rows.map(row => row.blob));
        };
        req.onerror = () => {
            db.close();
            reject(req.error ?? new Error("Failed to read chunks."));
        };
    });
}

export async function getDownloadChunkStats(sessionId: string) {
    const db = await openDatabase();
    return new Promise<{ count: number, totalBytes: number }>((resolve, reject) => {
        const tx = db.transaction(CHUNK_STORE, "readonly");
        const store = tx.objectStore(CHUNK_STORE);
        const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
        const req = store.openCursor(range);
        let count = 0;
        let totalBytes = 0;

        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
                return;
            }

            const record = cursor.value as DownloadChunkRecord;
            count += 1;
            totalBytes += record.blob.size;
            cursor.continue();
        };
        req.onerror = () => {
            db.close();
            reject(req.error ?? new Error("Failed to inspect chunks."));
        };
        tx.oncomplete = () => {
            db.close();
            resolve({ count, totalBytes });
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error ?? new Error("Chunk inspection failed."));
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error ?? new Error("Chunk inspection aborted."));
        };
    });
}

export async function deleteDownloadChunks(sessionId: string) {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CHUNK_STORE, "readwrite");
        const store = tx.objectStore(CHUNK_STORE);
        const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
        const req = store.openCursor(range);

        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
                return;
            }
            cursor.delete();
            cursor.continue();
        };
        req.onerror = () => {
            db.close();
            reject(req.error ?? new Error("Failed to delete chunks."));
        };
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error ?? new Error("Chunk cleanup failed."));
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error ?? new Error("Chunk cleanup aborted."));
        };
    });
}

function openDatabase() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CHUNK_STORE)) {
                db.createObjectStore(CHUNK_STORE, {
                    keyPath: ["sessionId", "index"],
                });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Failed to open direct download database."));
    });
}
