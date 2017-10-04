"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var sl = require("../sl");
var JsSIP = require("jssip-sl");
var interface_1 = require("./interface");
var stats_manager_1 = require("./stats_manager");
var sdp_munger_1 = require("./sdp_munger");
var statsPeriod = 10000;
function Call(config_, base_logger, logSdp) {
    var config = __assign({}, config_, { plugin: false, allowH264: sl.detectedBrowser === 'safari', websocket_port: 443 });
    var logger = base_logger.sub('CALL');
    var plugin = config.plugin;
    var statsManager = stats_manager_1.StatsManager(statsPeriod, logger);
    var endReason = null;
    if (!config.display_name) {
        throw 'missing display name';
    }
    else if (config.display_name.length > 100) {
        logger.debug('User name too long, trimming to 100 characters');
        config.display_name = config.display_name.slice(0, 100);
    }
    var handlers = (function () {
        var reg = {
            ringing: { cb: null, oneshot: true },
            in_call: { cb: null, oneshot: true },
            renegotiated: { cb: null, oneshot: true },
            audioonly: { cb: null, oneshot: false },
            addstream: { cb: null, oneshot: false },
            removestream: { cb: null, oneshot: false },
            pcstate: { cb: null, oneshot: false },
            ending: { cb: null, oneshot: true },
            ended: { cb: null, oneshot: true } // one CallEndReason will be returned
        };
        // ending is useful for users who want to display things before the call has ended
        var setHandler = function (event, handler) {
            reg[event].cb = handler;
        };
        var notify = function (event) {
            var args = [];
            for (var _i = 1; _i < arguments.length; _i++) {
                args[_i - 1] = arguments[_i];
            }
            if (reg[event].cb !== null) {
                (_a = reg[event]).cb.apply(_a, args);
                if (reg[event].oneshot) {
                    reg[event].cb = null;
                }
            }
            var _a;
        };
        var that = {
            setHandler: setHandler,
            notify: notify
        };
        return that;
    })();
    var userAgent;
    var rtcSession;
    var callEnding = true;
    var renegotiate = true;
    var renegotiateInProgress = false;
    var connectionTimeout = -1; // If we don't connect a websocket within 10 seconds, fail the call
    var sdpMunger = sdp_munger_1.SdpMunger(logger, logSdp, plugin, config.allowH264);
    var audioOnlyCall = false;
    var connected_ws = false;
    var onSdp = function (data) {
        if (data.originator === 'remote') {
            logger.info('Receiving SDP');
        }
        else {
            logger.info('Sending SDP');
        }
        var isAudioOnly = sdpMunger.isAudioOnly(data.sdp);
        if (data.originator === 'remote' && isAudioOnly !== audioOnlyCall) {
            handlers.notify('audioonly', isAudioOnly); //only notify when the audio only status of the call changes
            audioOnlyCall = isAudioOnly;
        }
        if (data.originator === 'local') {
            sdpMunger.mungeLocal(data);
            statsManager.processSdp(data); // always process stats in unified plan form
            handlers.notify('pcstate', sdpMunger.getPcState(data));
        }
        else {
            var pcstate_1 = sdpMunger.getPcState(data);
            if (pcstate_1 === interface_1.PCState.RECV && data.type === 'offer' && plugin) {
                // let JsSIP know to await for our callback. await returns a function we call when we're done.
                var finished_1 = data.await();
                sdpMunger.restartPC(data, rtcSession.connection, function () {
                    logger.debug('Sucessfully restarted PC stream');
                    statsManager.processSdp(data);
                    sdpMunger.mungeRemote(data);
                    finished_1();
                    handlers.notify('pcstate', pcstate_1);
                }, function () {
                    logger.error('Failed to restart PC stream');
                });
                return;
            }
            else {
                statsManager.processSdp(data);
                sdpMunger.mungeRemote(data);
                handlers.notify('pcstate', pcstate_1);
            }
        }
    };
    var onIceChange = function (event) {
        var pc = event.target;
        var ice = {
            gatheringState: pc.iceGatheringState,
            connectionState: pc.iceConnectionState,
            signalingState: pc.signalingState
        };
        logger.debug('Ice event: ', ice);
        var finalConnState = 'completed';
        if (sl.detectedBrowser === 'firefox') {
            finalConnState = 'connected';
        }
        if (ice.gatheringState === 'complete' &&
            ice.connectionState === finalConnState &&
            renegotiate &&
            !renegotiateInProgress) {
            renegotiateInProgress = true;
            sdpMunger.onIceComplete(rtcSession.connection, audioOnlyCall, function () {
                var mutestatus = rtcSession.isMuted();
                rtcSession.renegotiate({}, function () {
                    finishedRenegotiation();
                    mute(mutestatus);
                });
            });
        }
        else if (ice.connectionState === 'failed') {
            logger.error('Ice connection state failed - ending the call');
            endReason = interface_1.CallEndReason.ICE_FAILURE;
            onCallError();
        }
    };
    var muteStatus;
    var dial = function (options) {
        var jssip_config = {
            uri: 'unknown@' + config.org_domain,
            sockets: [new JsSIP.WebSocketInterface('wss://' + config.org_domain + ':' + config.websocket_port)],
            display_name: config.display_name,
            register: false,
            session_timers: false
        };
        endReason = null;
        callEnding = false;
        logger.info('UserCall to: ', config.target);
        if (options.mediaConstraints || options.mediaStream) {
            userAgent = new JsSIP.UA(jssip_config);
            userAgent.on('connected', function () {
                logger.info('Useragent connected');
                handlers.notify('ringing');
                callConnected(options);
            });
            userAgent.on('disconnected', function (event) {
                logger.info('Useragent disconnected');
                userAgentDisconnect(event);
            });
            userAgent.on('newRTCSession', function (e) {
                rtcSession = e.session;
                muteStatus = rtcSession.isMuted();
                logger.info('Initial mute status = ', muteStatus);
                // rtcSession.on('sending', function(event) {
                //     let sip_call_id = config.call_number + '@' + config.suid;
                //     event.request.setHeader('call-id', sip_call_id);
                // });
                rtcSession.on('ended', function (event) {
                    logger.debug('RtcSession ended');
                    onCallError(event);
                });
                rtcSession.on('failed', function (event) {
                    logger.warn('RtcSession failure');
                    onCallError(event);
                });
                rtcSession.on('confirmed', function () {
                    logger.info('RtcSession confirmed');
                    confirmed();
                });
                rtcSession.on('peerconnection', function (event) {
                    statsManager.start(event.peerconnection);
                    logger.info('RtcSession peerConnection created');
                    event.peerconnection.onaddstream = function (ev) {
                        handlers.notify('addstream', ev.stream);
                    };
                    event.peerconnection.onremovestream = function (ev) {
                        handlers.notify('removestream', ev.stream);
                    };
                    event.peerconnection.oniceconnectionstatechange = function (ev) {
                        onIceChange(ev);
                    };
                    event.peerconnection.onnegotiationneeded = function () {
                        muteStatus = rtcSession.isMuted();
                        rtcSession.renegotiate({}, function () {
                            mute(muteStatus);
                        });
                    };
                });
                rtcSession.on('sdp', function (event) {
                    onSdp(event);
                });
                rtcSession.on('reinvite', function (event) {
                    logger.info('Reinvite');
                    muteStatus = rtcSession.isMuted();
                    event.callback = function () {
                        logger.info('Reinvite finished');
                        mute(muteStatus);
                    };
                });
            });
            userAgent.start();
            connectionTimeout = window.setTimeout(function () {
                logger.warn('WS connection timed out trying to connect');
                endReason = interface_1.CallEndReason.CONNECTION_TIMEOUT;
                onCallError();
            }, 10000);
        }
        else {
            throw 'Missing required parameters to make the slCall!';
        }
    };
    var callConnected = function (options) {
        window.clearTimeout(connectionTimeout);
        connected_ws = true;
        options.rtcOfferConstraints = {
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 1
        };
        logger.info('Sending sip invite to ', config.target, ' with options ', options.rtcOfferConstraints);
        if (!options.mediaStream) {
            var canvas = document.getElementById('canvas_vid');
            var ctx = canvas.getContext('2d');
            ctx.beginPath();
            ctx.rect(0, 0, 1280, 720);
            ctx.fillStyle = 'black';
            ctx.fill();
            if (canvas.captureStream) {
                options.mediaStream = canvas.captureStream(5);
            }
            else if (canvas.mozCaptureStream) {
                options.mediaStream = canvas.mozCaptureStream(5);
            }
            if (options.mediaStream) {
                logger.info('Created dummy media stream from canvas element.');
            }
        }
        sdpMunger.setLocalMedia(options.mediaStream);
        userAgent.call('sip:' + config.target, options);
    };
    var confirmed = function () {
        logger.debug('Call confirmed - going to in_call state');
        mute(muteStatus);
        handlers.notify('in_call');
    };
    var finishedRenegotiation = function () {
        logger.debug('Finished renegotiation');
        renegotiateInProgress = false;
        renegotiate = false;
        handlers.notify('renegotiated');
    };
    // this isn't called when the use hangs up.
    var translateSipEvent = function (event) {
        var r = interface_1.CallEndReason;
        if (event && event.originator && event.cause) {
            if (event.cause === JsSIP.C.causes.CANCELED) {
                return r.INTERNAL_ERROR;
            }
            else if (event.cause === JsSIP.C.causes.CONNECTION_ERROR) {
                return r.CONNECTION_ERROR;
            }
            else if (event.cause === JsSIP.C.causes.BYE) {
                if (event.originator === 'remote') {
                    return r.REMOTE_BYE;
                }
                else {
                    return r.USER_BYE;
                }
            }
            else if (event.cause === JsSIP.C.causes.NOT_FOUND) {
                return r.NOT_FOUND;
            }
            else if (event.cause === JsSIP.C.causes.REQUEST_TIMEOUT) {
                return r.SIP_ERROR;
            }
            else if (event.cause === JsSIP.C.causes.REJECTED) {
                return r.REJECTED;
            }
            else if (event.cause === JsSIP.C.causes.BUSY) {
                return r.BUSY;
            }
            else if (event.cause === JsSIP.C.causes.SIP_FAILURE_CODE) {
                return r.SIP_ERROR;
            }
            else if (event.cause === JsSIP.C.causes.UNAVAILABLE) {
                return r.UNAVAILABLE;
            }
            else {
                return r.INTERNAL_ERROR;
            }
        }
        else {
            logger.error('Unknown error in call');
            return r.INTERNAL_ERROR;
        }
    };
    var shutdown = function () {
        statsManager.stop();
        sdpMunger.stop();
        if (rtcSession) {
            rtcSession.unmute({ audio: true, video: true });
        }
        window.clearTimeout(connectionTimeout);
    };
    var hangup = function () {
        shutdown();
        logger.debug('Hangup');
        handlers.notify('ending');
        if (renegotiateInProgress) {
            //if we've started the reinvite process, give it some time to complete.
            //it is invalid to send a bye whilst awaiting a response
            //but don't wait forever
            window.setTimeout(function () {
                renegotiateInProgress = false;
                hangup();
            }, 1000);
        }
        else {
            endReason = interface_1.CallEndReason.USER_BYE;
            try {
                userAgent.stop();
            }
            catch (ex) {
                logger.warn('Exception stopping user agent after user hangup ', ex);
            }
        }
    };
    var onCallError = function (jssipEvent) {
        shutdown();
        logger.debug('Rtc session has ended');
        if (jssipEvent) {
            logger.debug('Due to ', jssipEvent);
        }
        handlers.notify('ending');
        if (!callEnding) {
            callEnding = true;
            try {
                userAgent.stop();
            }
            catch (ex) {
                logger.warn('Exception stopping user agent after rtcSession ended/failed ', ex);
            }
            if (!endReason && jssipEvent) {
                endReason = translateSipEvent(jssipEvent);
            }
        }
    };
    var userAgentDisconnect = function (event) {
        shutdown();
        if (event && event.code !== 1000 && !callEnding) {
            handlers.notify('ending');
            logger.warn('Websocket closed - ending call. ws event: ', event);
            try {
                userAgent.stop();
            }
            catch (ex) {
                logger.warn('Exception stopping user agent after disconnect ', ex);
            }
        }
        if (!endReason) {
            if (connected_ws) {
                logger.error('WS connection unexpected error');
                endReason = interface_1.CallEndReason.CONNECTION_ERROR;
            }
            else {
                logger.error('WS connection refused');
                endReason = interface_1.CallEndReason.CONNECTION_REFUSED;
            }
        }
        handlers.notify('ended', endReason);
    };
    var mute = function (media) {
        if (rtcSession) {
            if (typeof media.audio === 'boolean') {
                if (media.audio) {
                    logger.info('Muting audio');
                    rtcSession.mute({ audio: true });
                }
                else {
                    logger.info('Unmuting audio');
                    rtcSession.unmute({ audio: true });
                }
            }
            if (typeof media.video === 'boolean') {
                if (media.video) {
                    logger.info('Muting video');
                    rtcSession.mute({ video: true });
                }
                else {
                    logger.info('Unmuting video');
                    rtcSession.unmute({ video: true });
                }
            }
            // never mute the pc video track.
            var localstreams = rtcSession.connection.getLocalStreams();
            if (localstreams.length > 1) {
                var vtracks = localstreams[1].getVideoTracks();
                for (var i = 0; i < vtracks.length; i++) {
                    vtracks[i].enabled = true;
                }
            }
            muteStatus = rtcSession.isMuted();
            return true;
        }
        else {
            return false;
        }
    };
    var isMuted = function () {
        if (rtcSession) {
            return rtcSession.isMuted();
        }
        else {
            return { audio: false, video: false };
        }
    };
    var screenSenders = [];
    var canSwitchStreams = function (stream) {
        return rtcSession && stream && rtcSession.connection.signalingState !== 'closed';
    };
    var addPCStream = function (stream) {
        if (canSwitchStreams(stream)) {
            var audio_tracks = stream.getAudioTracks();
            if (audio_tracks.length > 0) {
                logger.error('PC stream has audio track');
            }
            if (sl.detectedBrowser === 'firefox') {
                stream.getTracks().forEach(function (track) {
                    var sender = rtcSession.connection.addTrack(track, stream);
                    screenSenders.push(sender);
                });
            }
            else {
                rtcSession.connection.addStream(stream);
            }
        }
    };
    var removePCStream = function (stream) {
        if (canSwitchStreams(stream)) {
            stream.getTracks().forEach(function (track) {
                track.stop();
            });
            if (sl.detectedBrowser === 'firefox') {
                screenSenders.forEach(function (sender) {
                    rtcSession.connection.removeTrack(sender);
                });
            }
            else {
                rtcSession.connection.removeStream(stream);
            }
        }
    };
    var that = {
        on: handlers.setHandler,
        dial: dial,
        hangup: hangup,
        mute: mute,
        isMuted: isMuted,
        addPCStream: addPCStream,
        removePCStream: removePCStream
    };
    return that;
}
exports.Call = Call;
