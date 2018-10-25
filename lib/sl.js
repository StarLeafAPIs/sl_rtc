"use strict";
/*
* Copyright (c) StarLeaf Limited, 2017
*/
Object.defineProperty(exports, "__esModule", { value: true });
const adapter = require("webrtc-adapter");
exports.detectedBrowser = adapter.browserDetails.browser;
exports.detectedVersion = adapter.browserDetails.version;
exports.browser_name = typeof exports.detectedBrowser === 'string' ? exports.detectedBrowser.toLowerCase() : '';
exports.browser_version = Number(exports.detectedVersion);
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
