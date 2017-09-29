"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var sl = require("../sl");
var constants_1 = require("./constants");
var helpers_1 = require("./helpers");
function LocalMedia(spec) {
    var logger = spec.logger.sub('LOCALMEDIA');
    var devices = {
        audioinput: [],
        audiooutput: [],
        videoinput: []
    };
    var processDevices = function (deviceInfos) {
        devices = {
            audioinput: [],
            audiooutput: [],
            videoinput: []
        };
        for (var i = 0; i !== deviceInfos.length; i++) {
            var deviceInfo = deviceInfos[i];
            var id = deviceInfo.id || deviceInfo.deviceId;
            if (!id) {
                continue;
            }
            var label = deviceInfo.label;
            var device = {
                id: id,
                label: label,
                text: ''
            };
            if (deviceInfo.kind === 'audioinput' || deviceInfo.kind === 'audio') {
                device.text = label.replace('Analog Stereo', '').trim();
                devices.audioinput.push(device);
            }
            else if (deviceInfo.kind === 'videoinput' || deviceInfo.kind === 'video') {
                device.text = label.replace(/\((.*)\)/g, '').trim();
                devices.videoinput.push(device);
            }
            else if (deviceInfo.kind === 'audiooutput') {
                device.text = label;
                devices.audiooutput.push(device);
            }
        }
        return devices;
    };
    function makeConstraints(request) {
        var constraints = {};
        if (request.audio) {
            constraints.audio = helpers_1.audioConstraints(request.audio.id, devices.audioinput, spec.plugin);
        }
        if (request.video) {
            constraints.video = helpers_1.videoConstraints(request.video.id, devices.videoinput, spec.plugin);
        }
        return constraints;
    }
    function getDevices() {
        return new Promise(function (resolve, reject) {
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices && !spec.plugin) {
                navigator.mediaDevices
                    .enumerateDevices()
                    .then(function (devices) {
                    resolve(processDevices(devices));
                })
                    .catch(reject);
            }
            else {
                // To support the older Temasys plugin, which doesn't use the standard enumerateDevices API
                try {
                    MediaStreamTrack.getSources(function (devices) {
                        resolve(processDevices(devices));
                    });
                }
                catch (err) {
                    reject(err);
                }
            }
        });
    }
    function permissionError(error) {
        return (error.name &&
            (error.name === constants_1.GumErrors.PERMISSION_DENIED ||
                error.name === constants_1.GumErrors.NOT_ALLOWED ||
                error.name === constants_1.GumErrors.PERMISSION_DISMISSED));
    }
    function getMediaStream(request) {
        return new Promise(function (resolve, reject) {
            var constraints = makeConstraints(request);
            logger.info('GUM with constraints ', JSON.parse(JSON.stringify(constraints)));
            window.getUserMedia(constraints, function (stream) {
                resolve(stream);
            }, function (error) {
                // reset device cookies in case it was selecting a dodgy camera source.
                helpers_1.deleteDeviceCookies();
                logger.warn('Initial GUM request failed: ', error);
                if (!permissionError(error) && constraints.video && constraints.audio) {
                    // Assume the request failed because camera access is blocked or there is no camera.
                    // Try to get an audio stream only.
                    constraints.video = undefined;
                    logger.warn('Retrying with constraints: ', constraints);
                    window.getUserMedia(constraints, resolve, function (error2) {
                        logger.error('Secondary attempt to acquire audio only failed');
                        if (sl.detectedBrowser === 'chrome') {
                            if (permissionError(error2)) {
                                logger.error('Permission denied, calling GUM with dummy params ' +
                                    'to force chrome to show enable cam and mic options');
                                navigator.mediaDevices
                                    .getUserMedia({ audio: {}, video: {} })
                                    .catch(function () { });
                            }
                        }
                        reject(error2);
                    });
                }
                else {
                    reject(error);
                }
            });
        });
    }
    return {
        getDevices: getDevices,
        getMediaStream: getMediaStream,
        cachedDevices: function () {
            return devices;
        }
    };
}
exports.LocalMedia = LocalMedia;
