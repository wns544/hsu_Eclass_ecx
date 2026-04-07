import {
    DIRECT_DOWNLOAD_STATE_KEY,
    DirectDownloadStateSnapshot,
    createEmptyDirectDownloadSnapshot,
} from "#/shared/direct-download-state";
import { renderDirectDownloadSections } from "#/shared/direct-download-dashboard";
import {
    DIRECT_DOWNLOAD_LOG_KEY,
    DirectDownloadLogSnapshot,
    createEmptyDirectDownloadLogSnapshot,
} from "#/shared/direct-download-log";
import { renderDirectDownloadLogSection } from "#/shared/direct-download-log-panel";

void initMonitorPage();

async function initMonitorPage() {
    const app = document.getElementById("app");
    if (!(app instanceof HTMLDivElement)) {
        return;
    }

    const shell = document.createElement("div");
    shell.className = "ecx-monitor-shell";

    const header = document.createElement("header");
    header.className = "ecx-monitor-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "ecx-monitor-title-wrap";

    const eyebrow = document.createElement("div");
    eyebrow.className = "ecx-monitor-eyebrow";
    eyebrow.textContent = "hsu-ecx";

    const title = document.createElement("h1");
    title.className = "ecx-monitor-title";
    title.textContent = "\uC9C1\uC811\uB2E4\uC6B4 \uC9C4\uD589\uD604\uD669";

    const subtitle = document.createElement("p");
    subtitle.className = "ecx-monitor-subtitle";
    subtitle.textContent = "\uC0C8 \uC9C1\uC811\uB2E4\uC6B4 \uC791\uC5C5\uC740 \uC774 \uD0ED\uC5D0 \uACC4\uC18D \uCD94\uAC00\uB418\uACE0, \uC774\uBBF8 \uC5F4\uB9B0 \uD0ED\uC740 \uADF8\uB300\uB85C \uC7AC\uC0AC\uC6A9\uB429\uB2C8\uB2E4.";

    const actions = document.createElement("div");
    actions.className = "ecx-monitor-actions";

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "ecx-monitor-secondary";
    exportButton.textContent = "\uB85C\uADF8 \uB0B4\uBCF4\uB0B4\uAE30";
    exportButton.addEventListener("click", async () => {
        exportButton.disabled = true;
        try {
            await chrome.runtime.sendMessage({
                type: "EXPORT_DIRECT_DOWNLOAD_LOGS",
            });
        } finally {
            window.setTimeout(() => {
                exportButton.disabled = false;
            }, 800);
        }
    });

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "ecx-monitor-secondary";
    clearButton.textContent = "\uB85C\uADF8 \uBE44\uC6B0\uAE30";
    clearButton.addEventListener("click", async () => {
        clearButton.disabled = true;
        try {
            await chrome.runtime.sendMessage({
                type: "CLEAR_DIRECT_DOWNLOAD_LOGS",
            });
        } finally {
            window.setTimeout(() => {
                clearButton.disabled = false;
            }, 800);
        }
    });

    actions.append(exportButton, clearButton);

    titleWrap.append(eyebrow, title, subtitle);
    header.append(titleWrap, actions);

    const content = document.createElement("main");
    content.className = "ecx-monitor-content";

    const logs = document.createElement("section");
    logs.className = "ecx-monitor-logs";

    shell.append(header, content, logs);
    app.append(shell);

    const renderState = (snapshot: DirectDownloadStateSnapshot) => {
        renderDirectDownloadSections(content, snapshot, {
            compact: false,
        });
        document.title = snapshot.activeCount > 0
            ? `(${snapshot.activeCount}) \uC9C1\uC811\uB2E4\uC6B4 \uC9C4\uD589\uD604\uD669`
            : "\uC9C1\uC811\uB2E4\uC6B4 \uC9C4\uD589\uD604\uD669";
    };

    const renderLogs = (snapshot: DirectDownloadLogSnapshot) => {
        renderDirectDownloadLogSection(logs, snapshot, {
            compact: false,
            limit: 20,
        });
    };

    renderState(await loadStateSnapshot());
    renderLogs(await loadLogSnapshot());

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") {
            return;
        }

        if (changes[DIRECT_DOWNLOAD_STATE_KEY]) {
            renderState((changes[DIRECT_DOWNLOAD_STATE_KEY].newValue as DirectDownloadStateSnapshot | undefined)
                ?? createEmptyDirectDownloadSnapshot());
        }

        if (changes[DIRECT_DOWNLOAD_LOG_KEY]) {
            renderLogs((changes[DIRECT_DOWNLOAD_LOG_KEY].newValue as DirectDownloadLogSnapshot | undefined)
                ?? createEmptyDirectDownloadLogSnapshot());
        }
    });
}

async function loadStateSnapshot() {
    const stored = await chrome.storage.local.get(DIRECT_DOWNLOAD_STATE_KEY);
    return (stored[DIRECT_DOWNLOAD_STATE_KEY] as DirectDownloadStateSnapshot | undefined)
        ?? createEmptyDirectDownloadSnapshot();
}

async function loadLogSnapshot() {
    const stored = await chrome.storage.local.get(DIRECT_DOWNLOAD_LOG_KEY);
    return (stored[DIRECT_DOWNLOAD_LOG_KEY] as DirectDownloadLogSnapshot | undefined)
        ?? createEmptyDirectDownloadLogSnapshot();
}
