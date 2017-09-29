import * as sl from '../sl';
import { ILogger } from '../sl';
import { GumErrors, DeviceList, DeviceInfo } from './constants';
import { deleteDeviceCookies, audioConstraints, videoConstraints } from './helpers';

declare var Promise: any;

interface rtcDeviceInfo {
    kind: string;
    label: string;
    id?: string;
    deviceId?: string;
}

export interface LocalMediaRequest {
    audio?: { id?: string };
    video?: { id?: string };
}

export function LocalMedia(spec: { logger: ILogger; plugin: boolean }) {
    let logger = spec.logger.sub('LOCALMEDIA');

    let devices: DeviceList = {
        audioinput: [],
        audiooutput: [],
        videoinput: []
    };

    let processDevices = function(deviceInfos: rtcDeviceInfo[]): DeviceList {
        devices = {
            audioinput: [],
            audiooutput: [],
            videoinput: []
        };

        for (let i = 0; i !== deviceInfos.length; i++) {
            let deviceInfo = deviceInfos[i];
            let id = deviceInfo.id || deviceInfo.deviceId;
            if (!id) {
                continue;
            }
            let label = deviceInfo.label;
            let device: DeviceInfo = {
                id: id,
                label: label,
                text: ''
            };
            if (deviceInfo.kind === 'audioinput' || deviceInfo.kind === 'audio') {
                device.text = label.replace('Analog Stereo', '').trim();
                devices.audioinput.push(device);
            } else if (deviceInfo.kind === 'videoinput' || deviceInfo.kind === 'video') {
                device.text = label.replace(/\((.*)\)/g, '').trim();
                devices.videoinput.push(device);
            } else if (deviceInfo.kind === 'audiooutput') {
                device.text = label;
                devices.audiooutput.push(device);
            }
        }
        return devices;
    };

    function makeConstraints(request: LocalMediaRequest) {
        let constraints: { audio?: Object; video?: Object } = {};
        if (request.audio) {
            constraints.audio = audioConstraints(request.audio.id, devices.audioinput, spec.plugin);
        }
        if (request.video) {
            constraints.video = videoConstraints(request.video.id, devices.videoinput, spec.plugin);
        }
        return constraints;
    }

    function getDevices(): Promise<DeviceList> {
        return new Promise((resolve: (_: DeviceList) => void, reject: (_: any) => void) => {
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices && !spec.plugin) {
                navigator.mediaDevices
                    .enumerateDevices()
                    .then((devices: rtcDeviceInfo[]) => {
                        resolve(processDevices(devices));
                    })
                    .catch(reject);
            } else {
                // To support the older Temasys plugin, which doesn't use the standard enumerateDevices API
                try {
                    (MediaStreamTrack as any).getSources((devices: rtcDeviceInfo[]) => {
                        resolve(processDevices(devices));
                    });
                } catch (err) {
                    reject(err);
                }
            }
        });
    }

    function permissionError(error: MediaStreamError) {
        return (
            error.name &&
            (error.name === GumErrors.PERMISSION_DENIED ||
                error.name === GumErrors.NOT_ALLOWED ||
                error.name === GumErrors.PERMISSION_DISMISSED)
        );
    }

    function getMediaStream(request: LocalMediaRequest): Promise<MediaStream> {
        return new Promise(function(resolve: (stream: MediaStream) => void, reject: any) {
            let constraints = makeConstraints(request);
            logger.info('GUM with constraints ', JSON.parse(JSON.stringify(constraints)));
            (window as any).getUserMedia(
                constraints,
                (stream: MediaStream) => {
                    resolve(stream);
                },
                (error: any) => {
                    // reset device cookies in case it was selecting a dodgy camera source.
                    deleteDeviceCookies();
                    logger.warn('Initial GUM request failed: ', error);
                    if (!permissionError(error) && constraints.video && constraints.audio) {
                        // Assume the request failed because camera access is blocked or there is no camera.
                        // Try to get an audio stream only.
                        constraints.video = undefined;
                        logger.warn('Retrying with constraints: ', constraints);

                        (window as any).getUserMedia(constraints, resolve, (error2: any) => {
                            logger.error('Secondary attempt to acquire audio only failed');
                            if (sl.detectedBrowser === 'chrome') {
                                if (permissionError(error2)) {
                                    logger.error(
                                        'Permission denied, calling GUM with dummy params ' +
                                            'to force chrome to show enable cam and mic options'
                                    );
                                    navigator.mediaDevices
                                        .getUserMedia({ audio: {}, video: {} })
                                        .catch(function() {});
                                }
                            }
                            reject(error2);
                        });
                    } else {
                        reject(error);
                    }
                }
            );
        });
    }

    return {
        getDevices: getDevices,
        getMediaStream: getMediaStream,
        cachedDevices: () => {
            return devices;
        }
    };
}
