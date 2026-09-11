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
import { createRepairSection } from "./repair";

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
    title.textContent = "\uC601\uC0C1 \uC791\uC5C5\uC2E4";

    const subtitle = document.createElement("p");
    subtitle.className = "ecx-monitor-subtitle";
    subtitle.textContent = "\uC601\uC0C1 \uB2E4\uC6B4\uB85C\uB4DC\uC640 \uC7AC\uC0DD \uBB38\uC81C \uBCF5\uAD6C\uB97C \uD55C \uACF3\uC5D0\uC11C \uAD00\uB9AC\uD569\uB2C8\uB2E4.";

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

    const workspace = document.createElement("section");
    workspace.className = "ecx-monitor-workspace";
    workspace.setAttribute("aria-label", "작업 공간");

    const sidebar = document.createElement("nav");
    sidebar.className = "ecx-monitor-sidebar";
    sidebar.setAttribute("aria-label", "작업 종류");
    const downloadTab = createWorkspaceTab("download", "영상 다운로드", "다운로드 진행 상황과 기록");
    const repairTab = createWorkspaceTab("repair", "영상 변환", "재생 위치 이동이 안 되는 영상을 복구");
    const splitButton = document.createElement("button");
    splitButton.type = "button";
    splitButton.className = "ecx-monitor-split";
    sidebar.append(downloadTab, repairTab, splitButton);

    const panes = document.createElement("div");
    panes.className = "ecx-monitor-panes";
    const downloadPane = document.createElement("section");
    downloadPane.className = "ecx-monitor-pane ecx-monitor-download-pane";
    downloadPane.dataset.panel = "download";
    downloadPane.setAttribute("aria-label", "영상 다운로드");
    downloadPane.append(content, logs);
    const repairPane = document.createElement("section");
    repairPane.className = "ecx-monitor-pane ecx-monitor-repair-pane";
    repairPane.dataset.panel = "repair";
    repairPane.setAttribute("aria-label", "영상 변환");
    repairPane.append(createRepairSection());
    workspace.append(sidebar, panes);

    type WorkspacePanel = "download" | "repair";
    const wideWorkspace = window.matchMedia("(min-width: 1180px)");
    let selectedPanel: WorkspacePanel = localStorage.getItem("ecx-monitor-selected-panel") === "repair" ? "repair" : "download";
    let splitPreferred = localStorage.getItem("ecx-monitor-split-view") === "true";
    const applyWorkspaceLayout = () => {
        const split = splitPreferred && wideWorkspace.matches;
        const activePane = selectedPanel === "download" ? downloadPane : repairPane;
        const otherPane = selectedPanel === "download" ? repairPane : downloadPane;
        panes.replaceChildren(activePane, otherPane);
        workspace.dataset.view = split ? "split" : "single";
        workspace.dataset.selected = selectedPanel;
        downloadTab.setAttribute("aria-current", selectedPanel === "download" ? "page" : "false");
        repairTab.setAttribute("aria-current", selectedPanel === "repair" ? "page" : "false");
        splitButton.disabled = !wideWorkspace.matches;
        splitButton.textContent = split ? "한 화면 보기" : "동시 보기";
        splitButton.title = wideWorkspace.matches ? "넓은 화면에서 두 작업을 나란히 봅니다." : "브라우저 너비가 1180px 이상일 때 사용할 수 있습니다.";
    };
    const selectPanel = (panel: WorkspacePanel) => {
        selectedPanel = panel;
        localStorage.setItem("ecx-monitor-selected-panel", panel);
        applyWorkspaceLayout();
    };
    downloadTab.addEventListener("click", () => selectPanel("download"));
    repairTab.addEventListener("click", () => selectPanel("repair"));
    splitButton.addEventListener("click", () => {
        splitPreferred = !splitPreferred;
        localStorage.setItem("ecx-monitor-split-view", String(splitPreferred));
        applyWorkspaceLayout();
    });
    wideWorkspace.addEventListener("change", applyWorkspaceLayout);
    applyWorkspaceLayout();

    shell.append(header, workspace);
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

function createWorkspaceTab(id: "download" | "repair", title: string, description: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ecx-monitor-workspace-tab";
    button.dataset.panel = id;
    const name = document.createElement("strong");
    name.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = description;
    button.append(name, detail);
    return button;
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
