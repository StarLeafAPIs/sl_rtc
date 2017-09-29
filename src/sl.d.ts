export declare type logFunc = (...args: any[]) => void;
export interface ILogger {
    debug: logFunc;
    info: logFunc;
    warn: logFunc;
    error: logFunc;
    sub: (prefix: string) => ILogger;
}
export declare function detectedBrowser: string;
