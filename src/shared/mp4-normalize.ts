import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, MP4, Mp4OutputFormat, Output } from "mediabunny";

export type Mp4NormalizeResult = { file: File; inputFormat: string; duration: number | null };
export type Mp4Stage = "analyzing" | "converting" | "verifying";

/** Creates a standard seekable MP4 after probing the actual file bytes. */
export async function normalizeToMp4(source: Blob, filename: string, onProgress?: (progress: number) => void, onStage?: (stage: Mp4Stage) => void): Promise<Mp4NormalizeResult> {
    onStage?.("analyzing");
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
    try {
        const inputFormat = await input.getFormat();
        const target = new BufferTarget();
        const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
        const conversion = await Conversion.init({
            input, output, tracks: "primary", copy: { mode: "forced", shiftTolerance: Infinity }, showWarnings: false,
        });
        if (!conversion.isValid || conversion.utilizedTracks.length === 0) {
            const reasons = conversion.discardedTracks.map(item => item.reason).join(", ");
            throw new Error(reasons ? `MP4로 그대로 옮길 수 없는 영상입니다: ${reasons}` : "영상 또는 음성 트랙을 찾을 수 없습니다.");
        }
        onStage?.("converting");
        conversion.onProgress = progress => onProgress?.(Math.round(progress * 100));
        await conversion.execute();
        if (!target.buffer || target.buffer.byteLength === 0) throw new Error("MP4 파일을 만들지 못했습니다.");
        const file = new File([target.buffer], `${filename.replace(/\.[^.]+$/, "").trim() || "video"}.mp4`, { type: "video/mp4" });
        onStage?.("verifying");
        const verification = new Input({ formats: [MP4], source: new BlobSource(file) });
        try {
            if (await verification.getFormat() !== MP4) throw new Error("완성 파일이 정상 MP4로 확인되지 않았습니다.");
            return { file, inputFormat: inputFormat.name, duration: await verification.getDurationFromMetadata() };
        } finally { verification.dispose(); }
    } finally { input.dispose(); }
}
