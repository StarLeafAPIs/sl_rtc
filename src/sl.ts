import adapter = require('webrtc-adapter');

export type logFunc = (...args: any[]) => void;

export interface ILogger {
    debug: logFunc;
    info: logFunc;
    warn: logFunc;
    error: logFunc;
    sub: (prefix: string) => ILogger; //should return a new logger, which logs with the prefix.
}

export var detectedBrowser = adapter.browserDetails.browser;
export var detectedVersion = adapter.browserDetails.version;
