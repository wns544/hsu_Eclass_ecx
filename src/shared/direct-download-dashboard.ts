import {
    DirectDownloadJobState,
    DirectDownloadStateSnapshot,
    formatBytes,
    getPhaseLabel,
    getProgressPercent,
    isActiveJob,
} from "#/shared/direct-download-state";

type RenderDashboardOptions = {
    compact?: boolean;
};

export function renderDirectDownloadSections(
    root: HTMLElement,
    snapshot: DirectDownloadStateSnapshot,
    options: RenderDashboardOptions = {},
) {
    const compact = options.compact === true;
    const activeJobs = snapshot.jobs.filter(isActiveJob);
    const completedJobs = snapshot.jobs.filter(job => !isActiveJob(job));
    const completedLimit = compact ? 3 : 8;

    root.replaceChildren();
    root.append(createSummary(snapshot));

    if (activeJobs.length > 0) {
        root.append(createSection("\uC9C4\uD589 \uC911", activeJobs, compact));
    } else {
        root.append(createEmptyState("\uD604\uC7AC \uC9C4\uD589 \uC911\uC778 \uC9C1\uC811\uB2E4\uC6B4 \uC791\uC5C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."));
    }

    if (completedJobs.length > 0) {
        root.append(createSection("\uCD5C\uADFC \uC791\uC5C5", completedJobs.slice(0, completedLimit), compact));
    }
}

function createSummary(snapshot: DirectDownloadStateSnapshot) {
    const completedCount = snapshot.jobs.filter(job => job.phase === "completed").length;
    const failedCount = snapshot.jobs.filter(job => job.phase === "failed").length;

    const section = document.createElement("section");
    section.className = "ecx-dd-summary";
    section.append(
        createSummaryCard("\uC9C4\uD589 \uC911", String(snapshot.activeCount)),
        createSummaryCard("\uC644\uB8CC", String(completedCount)),
        createSummaryCard("\uC2E4\uD328", String(failedCount)),
    );
    return section;
}

function createSummaryCard(label: string, value: string) {
    const el = document.createElement("article");
    el.className = "ecx-dd-summary-card";

    const valueEl = document.createElement("strong");
    valueEl.className = "ecx-dd-summary-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("span");
    labelEl.className = "ecx-dd-summary-label";
    labelEl.textContent = label;

    el.append(valueEl, labelEl);
    return el;
}

function createSection(title: string, jobs: DirectDownloadJobState[], compact: boolean) {
    const section = document.createElement("section");
    section.className = "ecx-dd-section";

    const heading = document.createElement("div");
    heading.className = "ecx-dd-section-head";

    const titleEl = document.createElement("h2");
    titleEl.className = "ecx-dd-section-title";
    titleEl.textContent = title;

    const countEl = document.createElement("span");
    countEl.className = "ecx-dd-section-count";
    countEl.textContent = String(jobs.length);

    heading.append(titleEl, countEl);

    const list = document.createElement("div");
    list.className = "ecx-dd-list";
    for (const job of jobs) {
        list.append(createJobCard(job, compact));
    }

    section.append(heading, list);
    return section;
}

function createJobCard(job: DirectDownloadJobState, compact: boolean) {
    const card = document.createElement("article");
    card.className = "ecx-dd-card";
    card.dataset.phase = job.phase;

    const head = document.createElement("div");
    head.className = "ecx-dd-card-head";

    const textWrap = document.createElement("div");
    textWrap.className = "ecx-dd-card-copy";

    const courseName = document.createElement("div");
    courseName.className = "ecx-dd-course";
    courseName.textContent = job.courseName || "\uACFC\uBAA9 \uC815\uBCF4 \uC5C6\uC74C";

    const title = document.createElement("div");
    title.className = "ecx-dd-title";
    title.textContent = job.title;

    textWrap.append(courseName, title);

    const phase = document.createElement("span");
    phase.className = "ecx-dd-phase";
    phase.textContent = getPhaseLabel(job.phase);

    head.append(textWrap, phase);

    const status = document.createElement("div");
    status.className = "ecx-dd-status";
    status.textContent = buildStatusText(job);

    const progress = document.createElement("div");
    progress.className = "ecx-dd-progress";

    const progressFill = document.createElement("div");
    progressFill.className = "ecx-dd-progress-fill";
    progressFill.style.width = `${getProgressPercent(job)}%`;
    progress.append(progressFill);

    const meta = document.createElement("div");
    meta.className = "ecx-dd-meta";

    for (const item of buildMetaItems(job, compact)) {
        const metaEl = document.createElement("span");
        metaEl.className = "ecx-dd-meta-item";
        metaEl.textContent = item;
        meta.append(metaEl);
    }

    card.append(head, status, progress, meta);
    return card;
}

function buildStatusText(job: DirectDownloadJobState) {
    if (job.phase === "queued" && typeof job.queuePosition === "number") {
        return `\uB300\uAE30\uC5F4 ${job.queuePosition}\uBC88\uC9F8`;
    }

    if (job.phase === "downloading" && typeof job.progressPercent === "number") {
        return `${job.statusText} ${job.progressPercent}%`;
    }

    return job.statusText || getPhaseLabel(job.phase);
}

function buildMetaItems(job: DirectDownloadJobState, compact: boolean) {
    const items: string[] = [];

    if (typeof job.progressCurrent === "number" && typeof job.progressTotal === "number" && job.progressTotal > 0) {
        items.push(`${job.progressCurrent}/${job.progressTotal} \uC870\uAC01`);
    }

    if (typeof job.finalBytes === "number") {
        items.push(formatBytes(job.finalBytes));
    } else if (typeof job.downloadedBytes === "number") {
        items.push(`${formatBytes(job.downloadedBytes)} \uC218\uC9D1`);
    }

    if (!compact) {
        items.push(formatUpdatedAt(job.updatedAt));
    }

    if (job.phase === "failed" && job.error) {
        items.push(job.error);
    }

    return items.slice(0, compact ? 2 : 4);
}

function formatUpdatedAt(timestamp: number) {
    if (!timestamp) {
        return "-";
    }

    return new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(timestamp);
}

function createEmptyState(text: string) {
    const section = document.createElement("section");
    section.className = "ecx-dd-empty";
    section.textContent = text;
    return section;
}
