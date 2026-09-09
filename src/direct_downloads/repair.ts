import { normalizeToMp4 } from "#/shared/mp4-normalize";
import { formatBytes } from "#/shared/direct-download-state";

type Phase = "queued" | "analyzing" | "converting" | "verifying" | "saving" | "completed" | "failed" | "skipped";
const labels: Record<Phase, string> = {
    queued: "대기", analyzing: "파일 읽기", converting: "MP4 정리", verifying: "결과 검사",
    saving: "원본 교체", completed: "완료", failed: "실패", skipped: "건너뜀",
};
const steps: Phase[] = ["analyzing", "converting", "verifying", "saving"];
type FilePickerWindow = Window & {
    showOpenFilePicker?: (options: unknown) => Promise<RepairFileHandle[]>;
};
type RepairFileHandle = FileSystemFileHandle & {
    requestPermission: (options?: { mode?: "read" | "readwrite" }) => Promise<"granted" | "denied">;
};
type RepairLogEntry = { timestamp: number; name: string; phase: "completed" | "failed" | "skipped"; message?: string };
const REPAIR_LOG_KEY = "ecxRepairLogs";
type Job = {
    handle: RepairFileHandle;
    phase: Phase;
    percent?: number;
    bytes?: number;
    started?: number;
    ended?: number;
    error?: string;
    card: HTMLElement;
    badge: HTMLElement;
    detail: HTMLElement;
    meta: HTMLElement;
    progress: HTMLProgressElement;
    progressText: HTMLElement;
    stages: HTMLElement[];
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function elapsed(milliseconds: number) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`;
}

function createJob(handle: RepairFileHandle, index: number): Job {
    const card = el("article", "ecx-repair-card");
    const head = el("div", "ecx-repair-card-head");
    const number = el("span", "ecx-repair-number", String(index + 1).padStart(2, "0"));
    number.setAttribute("aria-hidden", "true");
    const copy = el("div", "ecx-repair-copy");
    const name = el("h3", "ecx-repair-filename", handle.name);
    name.title = handle.name;
    const meta = el("span", "ecx-repair-meta", "순서대로 처리할 예정입니다");
    copy.append(name, meta);
    const badge = el("span", "ecx-repair-badge");
    head.append(number, copy, badge);
    const stageList = el("ol", "ecx-repair-steps");
    stageList.setAttribute("aria-label", "복구 단계");
    const stages = steps.map(phase => {
        const step = el("li", "", labels[phase]);
        stageList.append(step);
        return step;
    });
    const progressRow = el("div", "ecx-repair-progress-row");
    const progress = el("progress", "ecx-repair-progress");
    progress.max = 100;
    progress.setAttribute("aria-label", `${handle.name} 진행 상태`);
    const progressText = el("span", "ecx-repair-progress-text");
    progressRow.append(progress, progressText);
    const detail = el("p", "ecx-repair-detail");
    card.append(head, stageList, progressRow, detail);
    return { handle, phase: "queued", card, badge, detail, meta, progress, progressText, stages };
}

function updateJob(job: Job) {
    const { phase } = job;
    job.card.dataset.phase = phase;
    job.badge.textContent = labels[phase];
    const active = steps.includes(phase);
    job.card.setAttribute("aria-busy", String(active));
    const position = steps.indexOf(phase);
    job.stages.forEach((step, index) => {
        step.dataset.state = phase === "completed" || (position >= 0 && index < position) ? "done"
            : index === position ? "current" : "pending";
        if (index === position) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
    });
    if (phase === "converting" && job.percent !== undefined && job.percent < 100) {
        job.progress.value = job.percent;
        job.progressText.textContent = `정리 ${job.percent}%`;
    } else if (active) {
        job.progress.removeAttribute("value");
        job.progressText.textContent = phase === "converting"
            ? job.percent === 100 ? "마무리 중" : "정리 중"
            : labels[phase];
    } else {
        job.progress.value = phase === "completed" ? 100 : 0;
        job.progressText.textContent = phase === "completed" ? "100%" : labels[phase];
    }
    const seconds = job.started ? (job.ended ?? Date.now()) - job.started : 0;
    job.meta.textContent = [job.bytes !== undefined ? formatBytes(job.bytes) : null,
        job.started ? `${elapsed(seconds)} ${job.ended ? "소요" : "경과"}` : "처리 대기"].filter(Boolean).join(" · ");
    const descriptions: Record<Phase, string> = {
        queued: "앞 영상이 끝나면 자동으로 시작합니다.",
        analyzing: seconds >= 30000
            ? "파일 응답을 기다리고 있습니다. 마운트 앱의 다운로드·연결 상태를 확인해 주세요."
            : "파일을 읽고 구조를 확인합니다. 마운트 폴더는 내려받는 시간이 포함될 수 있습니다.",
        converting: "영상과 음성을 다시 압축하지 않고 MP4로 정리합니다.",
        verifying: "완성된 파일을 다시 열어 MP4 형식을 확인합니다.",
        saving: "검사를 마친 파일을 같은 위치에 기록합니다. 완료될 때까지 이 탭을 열어 두세요.",
        completed: "파일 교체 완료. 마운트 폴더의 클라우드 동기화는 마운트 앱에서 확인하세요.",
        failed: job.error || "처리하지 못했습니다.",
        skipped: "사용자가 대기를 중단해 이 파일은 처리하지 않았습니다.",
    };
    job.detail.textContent = descriptions[phase];
}

export function createRepairSection() {
    const section = el("section", "ecx-repair");
    section.setAttribute("aria-label", "영상 복구");
    const head = el("div", "ecx-repair-header");
    const heading = el("div", "ecx-repair-heading");
    heading.append(el("span", "ecx-repair-eyebrow", "VIDEO REPAIR"), el("h2", "", "영상 복구"),
        el("p", "ecx-repair-description", "여러 영상을 선택하면 한 파일씩 정리하고 같은 이름으로 교체합니다."));
    const actions = el("div", "ecx-repair-actions");
    const button = el("button", "ecx-repair-select", "+ 영상 선택 후 복구");
    button.type = "button";
    const stop = el("button", "ecx-repair-stop", "이 파일까지만 처리");
    stop.type = "button";
    stop.hidden = true;
    actions.append(button, stop);
    head.append(heading, actions);
    const notice = el("p", "ecx-repair-notice", "로컬·Google Drive 마운트 폴더 지원 · 처리 중에는 이 탭을 열어 두세요.");
    const status = el("p", "ecx-repair-status", "복구할 영상을 선택해 주세요. Ctrl 또는 ⌘ 키로 여러 개를 고를 수 있습니다.");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const summary = el("div", "ecx-repair-summary");
    summary.hidden = true;
    const counters = el("div", "ecx-repair-counters");
    const values = ["선택한 영상", "완료", "실패", "대기"].map(label => {
        const counter = el("div", "ecx-repair-counter");
        const value = el("strong", "", "0");
        counter.append(value, el("span", "", label));
        counters.append(counter);
        return value;
    });
    const batchLabel = el("p", "ecx-repair-batch-label");
    const batchProgress = el("progress", "ecx-repair-batch-progress");
    batchProgress.setAttribute("aria-label", "전체 처리 파일 수");
    summary.append(counters, batchLabel, batchProgress);
    const list = el("div", "ecx-repair-list");
    const logSection = el("div", "ecx-repair-history");
    const logHeading = el("h3", "ecx-repair-history-title", "최근 복구 기록");
    const logList = el("ul", "ecx-repair-history-list");
    logSection.append(logHeading, logList);
    section.append(head, notice, status, summary, list, logSection);
    let jobs: Job[] = [];
    let stopRequested = false;
    let processing = false;

    const renderHistory = async () => {
        const stored = await chrome.storage.local.get(REPAIR_LOG_KEY);
        const entries = Array.isArray(stored[REPAIR_LOG_KEY]) ? stored[REPAIR_LOG_KEY] as RepairLogEntry[] : [];
        logList.replaceChildren(...entries.slice(0, 12).map(entry => {
            const item = el("li", "ecx-repair-history-item");
            item.dataset.phase = entry.phase;
            const date = new Date(entry.timestamp).toLocaleString();
            const label = entry.phase === "completed" ? "완료" : entry.phase === "failed" ? "실패" : "건너뜀";
            item.append(el("span", "ecx-repair-history-badge", label),
                el("span", "ecx-repair-history-name", entry.name),
                el("time", "ecx-repair-history-time", date));
            if (entry.message) item.title = entry.message;
            return item;
        }));
    };
    const saveHistory = async (job: Job) => {
        if (!(job.phase === "completed" || job.phase === "failed" || job.phase === "skipped")) return;
        const stored = await chrome.storage.local.get(REPAIR_LOG_KEY);
        const entries = Array.isArray(stored[REPAIR_LOG_KEY]) ? stored[REPAIR_LOG_KEY] as RepairLogEntry[] : [];
        entries.unshift({ timestamp: Date.now(), name: job.handle.name, phase: job.phase, message: job.error });
        await chrome.storage.local.set({ [REPAIR_LOG_KEY]: entries.slice(0, 50) });
        await renderHistory();
    };
    void renderHistory();

    const refreshSummary = () => {
        const completed = jobs.filter(job => job.phase === "completed").length;
        const failed = jobs.filter(job => job.phase === "failed").length;
        const queued = jobs.filter(job => job.phase === "queued").length;
        const skipped = jobs.filter(job => job.phase === "skipped").length;
        [jobs.length, completed, failed, queued].forEach((value, index) => values[index].textContent = String(value));
        batchProgress.max = jobs.length || 1;
        batchProgress.value = completed + failed + skipped;
        batchLabel.textContent = `${completed + failed + skipped} / ${jobs.length}개 처리 종료 · 파일 수 기준${skipped ? ` · ${skipped}개 건너뜀` : ""}`;
    };
    const setPhase = (job: Job, phase: Phase) => {
        job.phase = phase;
        if (["completed", "failed", "skipped"].includes(phase)) job.ended = Date.now();
        updateJob(job);
        refreshSummary();
        status.textContent = `${job.handle.name} · ${labels[phase]}`;
        void saveHistory(job);
    };
    stop.addEventListener("click", () => {
        stopRequested = true;
        stop.disabled = true;
        stop.textContent = "현재 파일을 마치고 중단합니다";
    });

    button.addEventListener("click", async () => {
        const picker = (window as FilePickerWindow).showOpenFilePicker;
        if (!picker) {
            status.textContent = "Windows 또는 macOS의 최신 Chrome에서 열어 주세요.";
            return;
        }
        button.disabled = true;
        let clock: ReturnType<typeof setInterval> | undefined;
        try {
            const handles = await picker.call(window, {
                multiple: true,
                types: [{ description: "동영상 파일", accept: { "video/*": [".mp4", ".ts", ".m4s", ".mov"] } }],
            });
            if (!handles.length) return;
            // Request write access while this click still has user activation.
            // Waiting until after a Drive file has been read/transcoded makes
            // Chrome reject createWritable() with User activation is required.
            const permissions = await Promise.all(handles.map(handle => handle.requestPermission({ mode: "readwrite" })));
            if (permissions.some(permission => permission !== "granted")) {
                throw new Error("하나 이상의 파일에 대한 쓰기 권한이 허용되지 않았습니다.");
            }
            const addedJobs = handles.map((handle, index) => createJob(handle, jobs.length + index));
            jobs.push(...addedJobs);
            list.append(...addedJobs.map(job => job.card));
            addedJobs.forEach(updateJob);
            summary.hidden = false;
            refreshSummary();
            if (processing) {
                status.textContent = `${handles.length}개 영상이 처리 대기열에 추가되었습니다.`;
                return;
            }
            processing = true;
            button.textContent = "+ 영상 추가";
            stopRequested = false;
            stop.disabled = false;
            stop.hidden = false;
            stop.textContent = "이 파일까지만 처리";
            clock = setInterval(() => jobs.filter(job => steps.includes(job.phase)).forEach(updateJob), 1000);
            let cursor = 0;
            while (cursor < jobs.length) {
                const job = jobs[cursor++];
                if (stopRequested) { setPhase(job, "skipped"); continue; }
                job.started = Date.now();
                setPhase(job, "analyzing");
                let writable: FileSystemWritableFileStream | undefined;
                try {
                    const original = await job.handle.getFile();
                    job.bytes = original.size;
                    updateJob(job);
                    const result = await normalizeToMp4(original, original.name, progress => {
                        job.percent = Math.max(0, Math.min(100, progress));
                        updateJob(job);
                    }, phase => setPhase(job, phase));
                    setPhase(job, "saving");
                    writable = await job.handle.createWritable();
                    await writable.write(result.file);
                    await writable.close();
                    writable = undefined;
                    setPhase(job, "completed");
                } catch (error) {
                    if (writable) await writable.abort().catch(() => undefined);
                    job.error = error instanceof Error ? error.message : "알 수 없는 오류";
                    setPhase(job, "failed");
                }
            }
            const count = (phase: Phase) => jobs.filter(job => job.phase === phase).length;
            status.textContent = `처리 종료 · 완료 ${count("completed")}개 · 실패 ${count("failed")}개${count("skipped") ? ` · 건너뜀 ${count("skipped")}개` : ""}`;
            processing = false;
            button.textContent = "+ 영상 선택 후 복구";
        } catch (error) {
            status.textContent = error instanceof DOMException && error.name === "AbortError"
                ? "파일 선택을 취소했습니다."
                : `파일을 선택하지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`;
        } finally {
            if (!processing && clock !== undefined) clearInterval(clock);
            button.disabled = false;
            if (!processing) button.textContent = "+ 영상 선택 후 복구";
            if (!processing) stop.hidden = true;
        }
    });
    return section;
}
