// https://learn.hansung.ac.kr/course/view.php?*

import { onLoad } from "#/utils/load";
import { fetchVideoList } from "#cs/fetch/video";
import { SwitchSelector, VideoSelector, AssignSelector, QuizSelector } from "#cs/fetch/course";

import videoExt from "./video";
import assignExt from "./assign";
import quizExt from "./quiz";

const SummaryExcl = ":not(.course_box0 .activity)";

onLoad(async () => {
    if (document.querySelector(SwitchSelector)) {
        return;
    }

    installResourceFilenameHook();

    const params = new URLSearchParams(location.search);
    const id = Number(params.get("id"));

    const videoList = await fetchVideoList(id);
    const sections = document.querySelectorAll("li.section");

    for (const section of sections) {
        const week = Number(section.id.split("-")[1]);
        const videoInfos = videoList[week];
        if (!videoInfos) {
            continue;
        }

        const videos = section.querySelectorAll(VideoSelector);
        videos.forEach((video, i) => videoExt(video, videoInfos[i], week));
    }

    const assigns = document.querySelectorAll(AssignSelector + SummaryExcl);
    assigns.forEach(assignExt);

    const quizzes = document.querySelectorAll(QuizSelector + SummaryExcl);
    quizzes.forEach(quizExt);

});

function installResourceFilenameHook() {
    document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const link = target.closest<HTMLAnchorElement>("a[href]");
        const activity = link?.closest("li.activity");
        const title = activity?.querySelector("span.instancename")?.firstChild?.textContent?.trim();
        const week = getActivityWeek(activity);
        const isResourceLink = link?.pathname.includes("/mod/resource/")
            || link?.pathname.includes("/pluginfile.php/")
            || activity?.classList.contains("resource");
        if (!link || !activity || !title || !week || !isResourceLink) {
            return;
        }

        event.preventDefault();
        const filenameBase = `${String(week).padStart(2, "0")}주차_${title}`;
        void chrome.runtime.sendMessage({
            type: "DOWNLOAD_COURSE_RESOURCE",
            sourceUrl: link.href,
            filenameBase,
        }).then((result: { ok?: boolean, error?: string }) => {
            if (!result?.ok) {
                throw new Error(result?.error || "파일 다운로드를 시작하지 못했습니다.");
            }
        }).catch((error) => {
            console.error("[ecx] course resource download failed", error);
            window.location.assign(link.href);
        });
    }, true);
}

function getActivityWeek(activity: Element | null | undefined) {
    const section = activity?.closest<HTMLElement>("li.section[id^='section-']");
    const value = Number(section?.id.replace("section-", ""));
    return Number.isFinite(value) && value > 0 ? value : 0;
}

export function insertBelow(act: Element, el: Element) {
    const inst = act.querySelector("div.activityinstance")!;
    inst.insertAdjacentElement("afterend", el);
}

export function insertAfter(act: Element, els: (Node | string)[]) {
    const inst = act.querySelector("div.activityinstance")!;
    inst.append(...els);
}
