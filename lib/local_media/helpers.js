"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Cookies = require("js-cookie");
function loadDeviceCookies() {
    return {
        mic_id: Cookies.get('WEBRTC_MIC_ID'),
        camera_id: Cookies.get('WEBRTC_CAMERA_ID'),
        speaker_id: Cookies.get('WEBRTC_SPEAKER_ID')
    };
}
function saveDeviceCookies(defaults) {
    if (defaults.mic_id) {
        Cookies.set('WEBRTC_MIC_ID', defaults.mic_id, { expires: 9000 });
    }
    if (defaults.camera_id) {
        Cookies.set('WEBRTC_CAMERA_ID', defaults.camera_id, { expires: 9000 });
    }
    if (defaults.speaker_id) {
        Cookies.set('WEBRTC_SPEAKER_ID', defaults.speaker_id, { expires: 9000 });
    }
}
function deleteDeviceCookies() {
    Cookies.remove('WEBRTC_MIC_ID');
    Cookies.remove('WEBRTC_CAMERA_ID');
    Cookies.remove('WEBRTC_SPEAKER_ID');
}
exports.deleteDeviceCookies = deleteDeviceCookies;
function audioConstraints(mic_id, device_list, plugin) {
    if (device_list.length === 0) {
        throw 'No audio devices!';
    }
    var defaults = loadDeviceCookies();
    if (!mic_id && defaults.mic_id) {
        for (var i = 0; i < device_list.length; i++) {
            if (device_list[i].id === defaults.mic_id) {
                mic_id = defaults.mic_id;
                break;
            }
        }
    }
    defaults.mic_id = mic_id;
    saveDeviceCookies(defaults);
    if (plugin) {
        return {
            sourceId: mic_id ? { exact: mic_id } : undefined
        };
    }
    else {
        return {
            deviceId: mic_id ? { exact: mic_id } : undefined
        };
    }
}
exports.audioConstraints = audioConstraints;
function videoConstraints(camera_id, device_list, plugin) {
    if (device_list.length === 0) {
        return undefined;
    }
    var defaults = loadDeviceCookies();
    if (!plugin) {
        if (!camera_id && defaults.camera_id) {
            for (var i = 0; i < device_list.length; i++) {
                if (device_list[i].id === defaults.camera_id) {
                    camera_id = defaults.camera_id;
                    break;
                }
            }
        }
        defaults.camera_id = camera_id;
        saveDeviceCookies(defaults);
    }
    if (plugin) {
        if (camera_id) {
            return {
                optional: [{ sourceId: camera_id }]
            };
        }
        else {
            return {
                width: 1280,
                height: 720,
                frameRate: 30
            };
        }
    }
    else {
        return {
            deviceId: camera_id ? { exact: camera_id } : undefined,
            width: 1280,
            height: 720,
            frameRate: 30
        };
    }
}
exports.videoConstraints = videoConstraints;
function setSpeaker(elements, speaker_id, device_list) {
    var defaults = loadDeviceCookies();
    if (!speaker_id) {
        if (defaults.speaker_id) {
            for (var i = 0; i < device_list.length; i++) {
                if (device_list[i].id === defaults.speaker_id) {
                    speaker_id = defaults.speaker_id;
                    break;
                }
            }
        }
    }
    if (!speaker_id) {
        deleteDeviceCookies();
        throw 'Failed to find suitable speaker id';
    }
    defaults.speaker_id = speaker_id;
    saveDeviceCookies(defaults);
    elements.forEach(function (element) {
        var el = element;
        if (typeof el.sinkId !== 'undefined' && speaker_id) {
            el.setSinkId(speaker_id).then(function () { });
        }
    });
    return speaker_id;
}
exports.setSpeaker = setSpeaker;
function muteVideo(video, muted) {
    if (muted !== undefined) {
        // hackily support the plugin
        var v = video;
        if (v.setProperty) {
            if (muted) {
                v.setProperty('muted');
            }
            else {
                v.removeProperty('muted');
            }
        }
        video.muted = muted;
    }
}
exports.muteVideo = muteVideo;
function recreateVideo(elem, muted) {
    var elem_class = elem.className;
    var parentDiv = elem.parentNode;
    if (!parentDiv) {
        throw 'Element not attached to DOM';
    }
    var id = elem.id;
    parentDiv.removeChild(elem);
    elem = document.createElement('video');
    parentDiv.appendChild(elem);
    elem.id = id;
    elem.className = elem_class;
    elem.autoplay = true;
    muteVideo(elem, muted);
    var new_elem = document.getElementById(id);
    if (!new_elem) {
        throw 'Failed to recreate element';
    }
    return new_elem;
}
exports.recreateVideo = recreateVideo;
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
exports.resize_tgt_tag = 'data-resize-tgt';
function fitVideo(elem) {
    var aspect = 16.0 / 9.0;
    if (elem.videoWidth && elem.videoHeight) {
        aspect = elem.videoWidth / elem.videoHeight;
    }
    var p = elem.parentNode;
    while (p && !p.getAttribute(exports.resize_tgt_tag)) {
        p = p.parentNode;
    }
    if (p) {
        var p_style = window.getComputedStyle(p);
        var pad_w = Number(p_style.getPropertyValue('padding-left').replace('px', '')) +
            Number(p_style.getPropertyValue('padding-right').replace('px', ''));
        var pad_h = Number(p_style.getPropertyValue('padding-top').replace('px', '')) +
            Number(p_style.getPropertyValue('padding-bottom').replace('px', ''));
        var w = p.clientWidth - pad_w;
        var h = p.clientHeight - pad_h;
        if (w / aspect < h) {
            h = w / aspect;
        }
        elem.width = w;
        elem.height = h;
        return {
            width: w,
            height: h
        };
    }
    else {
        return { width: 0, height: 0 };
    }
}
exports.fitVideo = fitVideo;
