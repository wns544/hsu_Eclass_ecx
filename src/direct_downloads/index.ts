import {
    DIRECT_DOWNLOAD_STATE_KEY,
    DirectDownloadStateSnapshot,
    createEmptyDirectDownloadSnapshot,
} from "#/shared/direct-download-state";
import { renderDirectDownloadSections } from "#/shared/direct-download-dashboard";

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

    titleWrap.append(eyebrow, title, subtitle);
    header.append(titleWrap);

    const content = document.createElement("main");
    content.className = "ecx-monitor-content";

    shell.append(header, content);
    app.append(shell);

    const render = (snapshot: DirectDownloadStateSnapshot) => {
        renderDirectDownloadSections(content, snapshot, {
            compact: false,
        });
        document.title = snapshot.activeCount > 0
            ? `(${snapshot.activeCount}) \uC9C1\uC811\uB2E4\uC6B4 \uC9C4\uD589\uD604\uD669`
            : "\uC9C1\uC811\uB2E4\uC6B4 \uC9C4\uD589\uD604\uD669";
    };

    render(await loadSnapshot());

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes[DIRECT_DOWNLOAD_STATE_KEY]) {
            return;
        }

        render((changes[DIRECT_DOWNLOAD_STATE_KEY].newValue as DirectDownloadStateSnapshot | undefined)
            ?? createEmptyDirectDownloadSnapshot());
    });
}

async function loadSnapshot() {
    const stored = await chrome.storage.local.get(DIRECT_DOWNLOAD_STATE_KEY);
    return (stored[DIRECT_DOWNLOAD_STATE_KEY] as DirectDownloadStateSnapshot | undefined)
        ?? createEmptyDirectDownloadSnapshot();
}
