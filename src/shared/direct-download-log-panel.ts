import {
    DirectDownloadLogEntry,
    DirectDownloadLogSnapshot,
    formatLogTimestamp,
    getCaptureModeLabel,
    getDetectionSourceLabel,
    getLogLevelLabel,
    sortLogs,
} from "#/shared/direct-download-log";
import { getPhaseLabel } from "#/shared/direct-download-state";

type RenderLogOptions = {
    compact?: boolean;
    limit?: number;
};

type DirectDownloadLogGroup = {
    key: string;
    latest: DirectDownloadLogEntry;
    entriesAsc: DirectDownloadLogEntry[];
    entryCount: number;
    title?: string;
    courseName?: string;
    captureEntry?: DirectDownloadLogEntry;
};

export function renderDirectDownloadLogSection(
    root: HTMLElement,
    snapshot: DirectDownloadLogSnapshot,
    options: RenderLogOptions = {},
) {
    const compact = options.compact === true;
    const limit = options.limit ?? (compact ? 6 : 20);
    const groups = buildLogGroups(snapshot.entries);
    const visibleGroups = groups.slice(0, limit);

    root.replaceChildren();

    const section = document.createElement("section");
    section.className = "ecx-log-section";

    const heading = document.createElement("div");
    heading.className = "ecx-log-section-head";

    const title = document.createElement("h2");
    title.className = "ecx-log-section-title";
    title.textContent = "\uCD5C\uADFC \uB85C\uADF8";

    const count = document.createElement("span");
    count.className = "ecx-log-section-count";
    count.textContent = String(groups.length);
    count.title = `\uC791\uC5C5 ${groups.length}\uAC74 / \uB85C\uADF8 ${snapshot.entries.length}\uC904`;

    heading.append(title, count);
    section.append(heading);

    if (visibleGroups.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ecx-log-empty";
        empty.textContent = "\uC544\uC9C1 \uC800\uC7A5\uB41C \uC9C1\uC811\uB2E4\uC6B4 \uB85C\uADF8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
        section.append(empty);
    } else {
        const list = document.createElement("div");
        list.className = "ecx-log-list";

        for (const group of visibleGroups) {
            list.append(createLogGroup(group, compact));
        }

        section.append(list);
    }

    root.append(section);
}

function buildLogGroups(entries: DirectDownloadLogEntry[]) {
    const latestFirst = sortLogs(entries);
    const grouped = new Map<string, DirectDownloadLogEntry[]>();

    for (const entry of latestFirst) {
        const key = getGroupKey(entry);
        const bucket = grouped.get(key);
        if (bucket) {
            bucket.push(entry);
        } else {
            grouped.set(key, [entry]);
        }
    }

    return [...grouped.entries()].map<DirectDownloadLogGroup>(([key, groupedEntries]) => {
        const latest = groupedEntries[0];
        const entriesAsc = [...groupedEntries].reverse();
        const captureEntry = [...entriesAsc].reverse()
            .find((entry) => entry.captureMode || entry.detectionSource);

        return {
            key,
            latest,
            entriesAsc,
            entryCount: groupedEntries.length,
            title: latest.title,
            courseName: latest.courseName,
            captureEntry,
        };
    });
}

function getGroupKey(entry: DirectDownloadLogEntry) {
    if (entry.jobId) {
        return entry.jobId;
    }

    const title = entry.title?.trim();
    const course = entry.courseName?.trim();
    if (title || course) {
        return `detached:${course ?? ""}:${title ?? ""}`;
    }

    return `entry:${entry.id}`;
}

function createLogGroup(group: DirectDownloadLogGroup, compact: boolean) {
    const item = document.createElement("details");
    item.className = "ecx-log-group";
    item.dataset.level = group.latest.level;
    item.dataset.compact = compact ? "true" : "false";

    const summary = document.createElement("summary");
    summary.className = "ecx-log-group-summary";

    const copy = document.createElement("div");
    copy.className = "ecx-log-group-copy";

    if (group.courseName) {
        const course = document.createElement("div");
        course.className = "ecx-log-group-course";
        course.textContent = group.courseName;
        copy.append(course);
    }

    const title = document.createElement("div");
    title.className = "ecx-log-group-title";
    title.textContent = group.title || "\uC81C\uBAA9 \uC815\uBCF4 \uC5C6\uC74C";
    copy.append(title);

    const message = document.createElement("div");
    message.className = "ecx-log-group-message";
    message.textContent = group.latest.message;
    copy.append(message);

    const tags = document.createElement("div");
    tags.className = "ecx-log-group-tags";

    if (group.captureEntry?.captureMode) {
        tags.append(createTag("ecx-log-group-tag ecx-log-group-tag-capture", getCaptureModeLabel(group.captureEntry.captureMode)));
    }
    if (group.captureEntry?.detectionSource) {
        tags.append(createTag("ecx-log-group-tag", `\uAC10\uC9C0: ${getDetectionSourceLabel(group.captureEntry.detectionSource)}`));
    }
    if (group.latest.phase && !compact) {
        tags.append(createTag("ecx-log-group-tag", `\uC0C1\uD0DC: ${getPhaseLabel(group.latest.phase)}`));
    }
    copy.append(tags);

    const meta = document.createElement("div");
    meta.className = "ecx-log-group-meta";

    const level = document.createElement("span");
    level.className = "ecx-log-level";
    level.textContent = getLogLevelLabel(group.latest.level);

    const time = document.createElement("span");
    time.className = "ecx-log-time";
    time.textContent = formatLogTimestamp(group.latest.timestamp);

    const count = document.createElement("span");
    count.className = "ecx-log-group-count";
    count.textContent = `${group.entryCount}\uAC1C`;

    meta.append(level, time, count);
    summary.append(copy, meta);

    const body = document.createElement("div");
    body.className = "ecx-log-group-body";

    const list = document.createElement("div");
    list.className = "ecx-log-group-list";
    for (const entry of group.entriesAsc) {
        list.append(createLogEntry(entry, compact));
    }
    body.append(list);

    item.append(summary, body);
    return item;
}

function createLogEntry(entry: DirectDownloadLogEntry, compact: boolean) {
    const item = document.createElement("article");
    item.className = "ecx-log-item";
    item.dataset.level = entry.level;

    const meta = document.createElement("div");
    meta.className = "ecx-log-meta";

    const level = document.createElement("span");
    level.className = "ecx-log-level";
    level.textContent = getLogLevelLabel(entry.level);

    const time = document.createElement("span");
    time.className = "ecx-log-time";
    time.textContent = formatLogTimestamp(entry.timestamp);

    meta.append(level, time);

    const message = document.createElement("div");
    message.className = "ecx-log-message";
    message.textContent = entry.message;

    item.append(meta, message);

    const labels = buildLabels(entry, compact);
    if (labels.length > 0) {
        const tags = document.createElement("div");
        tags.className = "ecx-log-tags";
        for (const labelText of labels) {
            tags.append(createTag("ecx-log-tag", labelText));
        }
        item.append(tags);
    }

    return item;
}

function buildLabels(entry: DirectDownloadLogEntry, compact: boolean) {
    const labels: string[] = [];

    if (!compact && entry.phase) {
        labels.push(`\uC0C1\uD0DC: ${getPhaseLabel(entry.phase)}`);
    }
    if (entry.captureMode) {
        labels.push(getCaptureModeLabel(entry.captureMode));
    }
    if (entry.detectionSource) {
        labels.push(`\uAC10\uC9C0: ${getDetectionSourceLabel(entry.detectionSource)}`);
    }
    if (!compact && entry.jobId) {
        labels.push(entry.jobId.slice(0, 8));
    }

    return labels.slice(0, compact ? 2 : 4);
}

function createTag(className: string, text: string) {
    const tag = document.createElement("span");
    tag.className = className;
    tag.textContent = text;
    return tag;
}
