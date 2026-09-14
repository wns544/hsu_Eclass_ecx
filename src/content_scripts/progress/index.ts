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
    const activities = document.querySelectorAll("li.activity, .activity");
    for (const activity of activities) {
        const link = activity.querySelector<HTMLAnchorElement>("a[href]");
        const title = activity?.querySelector("span.instancename")?.firstChild?.textContent?.trim()
            || link?.textContent?.trim();
        const week = getActivityWeek(activity);
        const iconLabel = activity?.querySelector<HTMLImageElement>("img.activityicon")?.alt || "";
        const isResourceLink = link?.pathname.includes("/mod/resource/")
            || link?.pathname.includes("/mod/ubfile/")
            || link?.pathname.includes("/mod/file/")
            || link?.pathname.includes("/pluginfile.php/")
            || activity?.classList.contains("resource")
            || /문서|파일|pdf|word|excel|powerpoint|text|zip/i.test(iconLabel);
        if (!link || !activity || !title || !week || !isResourceLink) {
            continue;
        }

        const filenameBase = `${String(week).padStart(2, "0")}주차_${title}`;
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "ecx-resource-download-trigger";
        trigger.title = `${filenameBase} 이름으로 다운로드`;
        trigger.setAttribute("aria-label", `${title} 다운로드`);
        trigger.append(...Array.from(link.childNodes));
        link.replaceWith(trigger);
        trigger.addEventListener("click", () => {
            showFilenameNotice(`${filenameBase} · 파일명 적용 후 다운로드 중`);
            void chrome.runtime.sendMessage({
                type: "DOWNLOAD_COURSE_RESOURCE",
                sourceUrl: link.href,
                filenameBase,
            }).then((result: { ok?: boolean, error?: string }) => {
                if (!result?.ok) {
                    throw new Error(result?.error || "파일 다운로드를 시작하지 못했습니다.");
                }
                showFilenameNotice(`${filenameBase} · 다운로드 시작됨`);
            }).catch((error) => {
                console.error("[ecx] course resource download failed", error);
                showFilenameNotice(`파일명 적용 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`, true);
            });
        });
    }
}

function getActivityWeek(activity: Element | null | undefined) {
    const section = activity?.closest<HTMLElement>("[id^='section-']");
    const value = Number(section?.id.replace("section-", ""));
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function showFilenameNotice(text: string, isError = false) {
    let notice = document.querySelector<HTMLDivElement>(".ecx-filename-notice");
    if (!notice) {
        notice = document.createElement("div");
        notice.className = "ecx-filename-notice";
        document.body.append(notice);
    }
    notice.dataset.variant = isError ? "error" : "success";
    notice.textContent = text;
    notice.hidden = false;
    window.setTimeout(() => { if (notice) notice.hidden = true; }, 3500);
}

export function insertBelow(act: Element, el: Element) {
    const inst = act.querySelector("div.activityinstance")!;
    inst.insertAdjacentElement("afterend", el);
}

export function insertAfter(act: Element, els: (Node | string)[]) {
    const inst = act.querySelector("div.activityinstance")!;
    inst.append(...els);
}
