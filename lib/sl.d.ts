export declare type logFunc = (...args: any[]) => void;
export interface ILogger {
    debug: logFunc;
    info: logFunc;
    warn: logFunc;
    error: logFunc;
    sub: (prefix: string) => ILogger;
}
export declare var detectedBrowser: string;
export declare var detectedVersion: string | number;
export declare function hasLocalMedia(stream?: MediaStream): {
    audio: boolean;
    video: boolean;
};
