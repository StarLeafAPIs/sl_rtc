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

export function hasLocalMedia(stream?: MediaStream): { audio: boolean; video: boolean } {
    if (!stream) {
        return { audio: false, video: false };
    }
    return {
        audio: stream.getAudioTracks().length !== 0,
        video: stream.getVideoTracks().length !== 0
    };
}
