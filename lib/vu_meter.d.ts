export declare const enum VolState {
    SILENT = 0,
    OK = 1,
    LOUD = 2
}
export declare function VolumeMeter(audio_ctx: AudioContext, canvas: HTMLCanvasElement, onChange?: (state: VolState) => void): {
    start: (stream: MediaStream) => void;
    stop: () => void;
};
