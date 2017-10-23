/*
* Copyright (c) StarLeaf Limited, 2017
*/

import adapter = require('webrtc-adapter');

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

export {ILogger, Logger} from './logger';
