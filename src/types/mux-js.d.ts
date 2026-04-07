declare module "mux.js" {
    type TransmuxedSegment = {
        initSegment?: Uint8Array;
        data?: Uint8Array;
    };

    type Transmuxer = {
        on(event: "data", listener: (segment: TransmuxedSegment) => void): void;
        on(event: "done", listener: () => void): void;
        push(data: Uint8Array): void;
        flush(): void;
    };

    const muxjs: {
        mp4: {
            Transmuxer: new (options?: {
                keepOriginalTimestamps?: boolean;
                remux?: boolean;
                baseMediaDecodeTime?: number;
            }) => Transmuxer;
        };
    };

    export default muxjs;
}
