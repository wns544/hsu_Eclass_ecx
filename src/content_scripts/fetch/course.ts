import { fetchParse } from "#/utils/fetch";

export interface CourseInfo {
    id: number;
    title: string;
}

export interface CourseVideo {
    title: string;
    id: number | null;
    laby: number | null;
    from: string;
    due: string;
    duration: number | null;
}

export interface CourseAssign {
    id: number;
    title: string;
}

export interface CourseQuiz {
    id: number;
    title: string;
}

export interface CourseCurrent {
    week: number;
    video: CourseVideo[];
    assign: CourseAssign[];
    quiz: CourseQuiz[];
}

export const SwitchSelector = "a.btn-switch";
export const VideoSelector = "li.activity:is(.vod, .laby):has(.text-ubstrap)";
export const AssignSelector = "li.activity.assign:has(a)";
export const QuizSelector = "li.activity.quiz:has(a)";

function buildCourseVideoKey(video: CourseVideo): string {
    const resourceKey = video.id !== null
        ? `id:${video.id}`
        : video.laby !== null
            ? `laby:${video.laby}`
            : `title:${video.title}`;

    return [
        resourceKey,
        `from:${video.from}`,
        `due:${video.due}`,
    ].join("|");
}

export async function fetchCourseList(): Promise<CourseInfo[]> {
    const doc = await fetchParse("/local/ubion/user/");
    const rows = doc.querySelectorAll("div.course_lists table > tbody > tr");

    const res: CourseInfo[] = [];
    for (const row of rows) {
        const tds = row.children;
        if (tds.length < 2) {
            continue;
        }

        const label = tds[1];
        const a = label.querySelector("a")!;

        const id = Number(new URL(a.href).searchParams.get("id"));
        const title = a.textContent!.trim();

        res.push({
            id,
            title,
        });
    }

    return res;
}

export async function fetchCourseCurrent(id: number): Promise<CourseCurrent> {
    const url = `/course/view.php?id=${id}`;
    const doc = await fetchParse(url);

    const res: CourseCurrent = {
        week: 0,
        video: [], assign: [], quiz: [],
    };

    if (document.querySelector(SwitchSelector)) {
        return res;
    }

    const current = doc.querySelector("div.course_box_current");
    if (!current) {
        return res;
    }

    const section = current.querySelector("ul.weeks > li.section")!;
    res.week = Number(section.id.split("-")[1]);

    const videos = current.querySelectorAll(VideoSelector);
    const assigns = current.querySelectorAll(AssignSelector);
    const quizzes = current.querySelectorAll(QuizSelector);

    const seenVideoKeys = new Set<string>();

    for (const video of videos) {
        const title = video.querySelector("span.instancename")!.firstChild!.textContent!.trim();
        const dateText = video.querySelector("span.text-ubstrap")!.textContent!.trim();
        const durationText = video.querySelector("span.text-info")?.textContent?.trim() ?? "";
        const [from, due] = parseDateRange(dateText);
        const duration = parseDuration(durationText);

        const a = video.querySelector("a");
        if (!a) {
            const parsedVideo = {
                title, from, due, duration,
                id: null, laby: null,
            };
            const videoKey = buildCourseVideoKey(parsedVideo);
            if (seenVideoKeys.has(videoKey)) {
                continue;
            }

            seenVideoKeys.add(videoKey);
            res.video.push(parsedVideo);
            continue;
        }

        const id = Number(new URL(a.href).searchParams.get("id"));
        const laby = video.classList.contains("laby")
            ? Number(a.getAttribute("onclick")!.match(/'\/mod\/laby\/viewer\.php\?i=(\d+)'/)![1])
            : null;

        const parsedVideo = {
            title,
            id,
            laby,
            from,
            due,
            duration,
        };
        const videoKey = buildCourseVideoKey(parsedVideo);
        if (seenVideoKeys.has(videoKey)) {
            continue;
        }

        seenVideoKeys.add(videoKey);
        res.video.push(parsedVideo);
    }

    for (const assign of assigns) {
        const a = assign.querySelector("a")!;
        const id = Number(new URL(a.href).searchParams.get("id"));

        const title = assign.querySelector("span.instancename")!
            .firstChild!.textContent!.trim();

        res.assign.push({
            id,
            title,
        });
    }

    for (const quiz of quizzes) {
        const a = quiz.querySelector("a")!;
        const id = Number(new URL(a.href).searchParams.get("id"));

        const title = quiz.querySelector("span.instancename")!
            .firstChild!.textContent!.trim();

        res.quiz.push({
            id,
            title,
        });
    }

    return res;
}

function parseDateRange(text: string): [string, string] {
    const matches = [...text.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g)].map(match => match[0]);
    if (matches.length < 2) {
        throw new Error(`Failed to parse date range: ${text}`);
    }
    return [new Date(matches[0]).toISOString(), new Date(matches[1]).toISOString()];
}

function parseDuration(text: string): number | null {
    const value = text.replace(/^,\s*/, "").trim();
    if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) {
        return null;
    }

    const parts = value.split(":").map(Number);
    if (parts.length === 3) {
        const [h, m, s] = parts;
        return h * 3600 + m * 60 + s;
    }

    const [m, s] = parts;
    return m * 60 + s;
}
