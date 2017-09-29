import { DeviceInfo } from './constants';
import * as Cookies from 'js-cookie';

type device_types = 'mic_id' | 'camera_id' | 'speaker_id';
type device_cookies = { [k in device_types]: string | null | undefined };

function loadDeviceCookies(): device_cookies {
    return {
        mic_id: Cookies.get('WEBRTC_MIC_ID'),
        camera_id: Cookies.get('WEBRTC_CAMERA_ID'),
        speaker_id: Cookies.get('WEBRTC_SPEAKER_ID')
    };
}

function saveDeviceCookies(defaults: device_cookies) {
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

export function deleteDeviceCookies() {
    Cookies.remove('WEBRTC_MIC_ID');
    Cookies.remove('WEBRTC_CAMERA_ID');
    Cookies.remove('WEBRTC_SPEAKER_ID');
}

export function audioConstraints(
    mic_id: string | undefined,
    device_list: DeviceInfo[],
    plugin: boolean
) {
    if (device_list.length === 0) {
        throw 'No audio devices!';
    }
    let defaults = loadDeviceCookies();
    if (!mic_id && defaults.mic_id) {
        for (let i = 0; i < device_list.length; i++) {
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
    } else {
        return {
            deviceId: mic_id ? { exact: mic_id } : undefined
        };
    }
}

export function videoConstraints(
    camera_id: string | undefined,
    device_list: DeviceInfo[],
    plugin: boolean
) {
    if (device_list.length === 0) {
        return undefined;
    }
    let defaults = loadDeviceCookies();
    if (!plugin) {
        if (!camera_id && defaults.camera_id) {
            for (let i = 0; i < device_list.length; i++) {
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
        } else {
            return {
                width: 1280,
                height: 720,
                frameRate: 30
            };
        }
    } else {
        return {
            deviceId: camera_id ? { exact: camera_id } : undefined,
            width: 1280,
            height: 720,
            frameRate: 30
        };
    }
}

export function setSpeaker(
    elements: HTMLVideoElement[],
    speaker_id: string | undefined,
    device_list: DeviceInfo[]
): string {
    let defaults = loadDeviceCookies();
    if (!speaker_id) {
        if (defaults.speaker_id) {
            for (let i = 0; i < device_list.length; i++) {
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

    elements.forEach(element => {
        let el = element as any;
        if (typeof el.sinkId !== 'undefined' && speaker_id) {
            el.setSinkId(speaker_id).then(function() {});
        }
    });
    return speaker_id;
}

export function muteVideo(video: HTMLVideoElement, muted?: boolean): void {
    if (muted !== undefined) {
        // hackily support the plugin
        let v = video as any;
        if (v.setProperty) {
            if (muted) {
                v.setProperty('muted');
            } else {
                v.removeProperty('muted');
            }
        }
        video.muted = muted;
    }
}

export function recreateVideo(elem: HTMLVideoElement, muted?: boolean): HTMLVideoElement {
    let elem_class = elem.className;
    let parentDiv = elem.parentNode;
    if (!parentDiv) {
        throw 'Element not attached to DOM';
    }
    let id = elem.id;
    parentDiv.removeChild(elem);
    elem = document.createElement('video');
    parentDiv.appendChild(elem);
    elem.id = id;
    elem.className = elem_class;
    elem.autoplay = true;
    muteVideo(elem, muted);
    let new_elem = document.getElementById(id);
    if (!new_elem) {
        throw 'Failed to recreate element';
    }
    return new_elem as HTMLVideoElement;
}

export function hasLocalMedia(stream?: MediaStream): { audio: boolean; video: boolean } {
    if (!stream) {
        return { audio: false, video: false };
    }
    return {
        audio: stream.getAudioTracks().length !== 0,
        video: stream.getVideoTracks().length !== 0
    };
}

export const resize_tgt_tag = 'data-resize-tgt';

export function fitVideo(elem: HTMLVideoElement): { width: number; height: number } {
    let aspect = 16.0 / 9.0;
    if (elem.videoWidth && elem.videoHeight) {
        aspect = elem.videoWidth / elem.videoHeight;
    }
    let p = elem.parentNode as HTMLElement;
    while (p && !p.getAttribute(resize_tgt_tag)) {
        p = p.parentNode as HTMLElement;
    }

    if (p) {
        let p_style = window.getComputedStyle(p);
        let pad_w =
            Number(p_style.getPropertyValue('padding-left').replace('px', '')) +
            Number(p_style.getPropertyValue('padding-right').replace('px', ''));
        let pad_h =
            Number(p_style.getPropertyValue('padding-top').replace('px', '')) +
            Number(p_style.getPropertyValue('padding-bottom').replace('px', ''));
        let w = p.clientWidth - pad_w;
        let h = p.clientHeight - pad_h;
        if (w / aspect < h) {
            h = w / aspect;
        }
        elem.width = w;
        elem.height = h;
        return {
            width: w,
            height: h
        };
    } else {
        return { width: 0, height: 0 };
    }
}
