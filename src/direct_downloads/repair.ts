import { normalizeToMp4 } from "#/shared/mp4-normalize";

type FilePickerWindow = Window & {
    showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
};

export function createRepairSection() {
    const section = document.createElement("section");
    section.className = "ecx-repair";
    const title = document.createElement("h2");
    title.textContent = "영상 복구";
    const description = document.createElement("p");
    description.textContent = "MP4처럼 보이지만 재생·뒤로 이동이 안 되는 영상을 정상 MP4로 고쳐 같은 파일에 반영합니다. Google Drive 마운트 폴더도 선택할 수 있습니다.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ecx-monitor-secondary";
    button.textContent = "영상 선택 후 복구";
    const status = document.createElement("p");
    status.className = "ecx-repair-status";

    button.addEventListener("click", async () => {
        const picker = (window as FilePickerWindow).showOpenFilePicker;
        if (!picker) {
            status.textContent = "이 기능은 Windows 또는 macOS의 최신 Chrome에서 사용할 수 있습니다.";
            return;
        }
        button.disabled = true;
        try {
            const [handle] = await picker({
                multiple: false,
                types: [{ description: "동영상 파일", accept: { "video/*": [".mp4", ".ts", ".m4s", ".mov"] } }],
            });
            if (!handle) return;
            const original = await handle.getFile();
            status.textContent = "파일 구조를 확인하고 호환 MP4로 정리하는 중...";
            const result = await normalizeToMp4(original, original.name, progress => {
                status.textContent = `정리 중... ${progress}%`;
            });
            status.textContent = "정상 MP4를 확인했습니다. 원본 파일을 교체하는 중...";
            const writable = await handle.createWritable();
            await writable.write(result.file);
            await writable.close();
            status.textContent = `${original.name} 복구 완료 (${result.inputFormat} → MP4). 마운트 폴더라면 클라우드 동기화 상태를 확인하세요.`;
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                status.textContent = "파일 선택을 취소했습니다.";
            } else {
                const message = error instanceof Error ? error.message : "알 수 없는 오류";
                status.textContent = `복구하지 못했습니다. 원본은 그대로입니다: ${message}`;
            }
        } finally {
            button.disabled = false;
        }
    });
    section.append(title, description, button, status);
    return section;
}
