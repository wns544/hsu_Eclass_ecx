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

void initPopup();

async function initPopup() {
    const app = document.getElementById("app");
    if (!(app instanceof HTMLDivElement)) {
        return;
    }

    const shell = document.createElement("div");
    shell.className = "ecx-popup-shell";

    const header = document.createElement("header");
    header.className = "ecx-popup-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "ecx-popup-title-wrap";

    const eyebrow = document.createElement("div");
    eyebrow.className = "ecx-popup-eyebrow";
    eyebrow.textContent = "hsu-ecx";

    const title = document.createElement("h1");
    title.className = "ecx-popup-title";
    title.textContent = "\uC9C1\uC811\uB2E4\uC6B4 \uD604\uD669";

    const subtitle = document.createElement("p");
    subtitle.className = "ecx-popup-subtitle";
    subtitle.textContent = "\uD604\uC7AC \uC9C4\uD589 \uC911\uC778 \uC791\uC5C5\uACFC \uCD5C\uADFC \uC644\uB8CC \uB0B4\uC5ED\uC744 \uBC14\uB85C \uD655\uC778\uD569\uB2C8\uB2E4.";

    titleWrap.append(eyebrow, title, subtitle);

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "ecx-popup-open";
    openButton.textContent = "\uC9C4\uD589 \uD0ED \uC5F4\uAE30";
    openButton.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
            type: "OPEN_DIRECT_DOWNLOAD_MONITOR",
            focus: true,
        });
        window.close();
    });

    const actions = document.createElement("div");
    actions.className = "ecx-popup-actions";

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "ecx-popup-secondary";
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
    clearButton.className = "ecx-popup-secondary";
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

    actions.append(exportButton, clearButton, openButton);
    header.append(titleWrap, actions);

    const content = document.createElement("main");
    content.className = "ecx-popup-content";

    const logs = document.createElement("section");
    logs.className = "ecx-popup-logs";

    shell.append(header, content, logs);
    app.append(shell);

    const renderState = (snapshot: DirectDownloadStateSnapshot) => {
        renderDirectDownloadSections(content, snapshot, {
            compact: true,
        });
    };

    const renderLogs = (snapshot: DirectDownloadLogSnapshot) => {
        renderDirectDownloadLogSection(logs, snapshot, {
            compact: true,
            limit: 6,
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
