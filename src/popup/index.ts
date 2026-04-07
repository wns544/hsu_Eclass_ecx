import {
    DIRECT_DOWNLOAD_STATE_KEY,
    DirectDownloadStateSnapshot,
    createEmptyDirectDownloadSnapshot,
} from "#/shared/direct-download-state";
import { renderDirectDownloadSections } from "#/shared/direct-download-dashboard";

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

    header.append(titleWrap, openButton);

    const content = document.createElement("main");
    content.className = "ecx-popup-content";

    shell.append(header, content);
    app.append(shell);

    const render = (snapshot: DirectDownloadStateSnapshot) => {
        renderDirectDownloadSections(content, snapshot, {
            compact: true,
        });
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
