"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter = require("webrtc-adapter");
exports.detectedBrowser = adapter.browserDetails.browser;
exports.detectedVersion = adapter.browserDetails.version;
function hasLocalMedia(stream) {
    if (!stream) {
        return { audio: false, video: false };
    }
    return {
        audio: stream.getAudioTracks().length !== 0,
        video: stream.getVideoTracks().length !== 0
    };
}
exports.hasLocalMedia = hasLocalMedia;
var logger_1 = require("./logger");
exports.Logger = logger_1.Logger;
