"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sl = require("../sl");
const JsSIP = require("jssip-sl");
const interface_1 = require("./interface");
const stats_manager_1 = require("./stats_manager");
const sdp_munger_1 = require("./sdp_munger");
const statsPeriod = 10000;
function Call(config_, base_logger, logSdp) {
    let config = Object.assign({}, config_, { plugin: false, allowH264: sl.detectedBrowser === 'safari', websocket_port: 443 });
    let logger = base_logger.sub('CALL');
    let plugin = config.plugin;
    let statsManager = stats_manager_1.StatsManager(statsPeriod, logger);
    let endReason = null;
    if (!config.display_name) {
        throw 'missing display name';
    }
    else if (config.display_name.length > 100) {
        logger.debug('User name too long, trimming to 100 characters');
        config.display_name = config.display_name.slice(0, 100);
    }
    let handlers = (function () {
        let reg = {
            ringing: { cb: null, oneshot: true },
            in_call: { cb: null, oneshot: true },
            renegotiated: { cb: null, oneshot: true },
            audio_only: { cb: null, oneshot: false },
            add_stream: { cb: null, oneshot: false },
            remove_stream: { cb: null, oneshot: false },
            pc_state: { cb: null, oneshot: false },
            ending: { cb: null, oneshot: true },
            ended: { cb: null, oneshot: true } // one CallEndReason will be returned
        };
        // ending is useful for users who want to display things before the call has ended
        let setHandler = function (event, handler) {
            reg[event].cb = handler;
        };
        let notify = function (event, ...args) {
            if (reg[event].cb !== null) {
                reg[event].cb(...args);
                if (reg[event].oneshot) {
                    reg[event].cb = null;
                }
            }
        };
        let that = {
            setHandler: setHandler,
            notify: notify
        };
        return that;
    })();
    let userAgent;
    let rtcSession;
    let callEnding = true;
    let renegotiate = true;
    let renegotiateInProgress = false;
    let connectionTimeout = -1; // If we don't connect a websocket within 10 seconds, fail the call
    let sdpMunger = sdp_munger_1.SdpMunger(logger, logSdp, plugin, config.allowH264);
    let audioOnlyCall = false;
    let connected_ws = false;
    let onSdp = function (data) {
        if (data.originator === 'remote') {
            logger.info('Receiving SDP');
        }
        else {
            logger.info('Sending SDP');
        }
        let isAudioOnly = sdpMunger.isAudioOnly(data.sdp);
        if (data.originator === 'remote' && isAudioOnly !== audioOnlyCall) {
            handlers.notify('audio_only', isAudioOnly); //only notify when the audio only status of the call changes
            audioOnlyCall = isAudioOnly;
        }
        if (data.originator === 'local') {
            sdpMunger.mungeLocal(data);
            statsManager.processSdp(data); // always process stats in unified plan form
            handlers.notify('pc_state', sdpMunger.getPcState(data));
        }
        else {
            let pcstate = sdpMunger.getPcState(data);
            if (pcstate === interface_1.PCState.RECV && data.type === 'offer' && plugin) {
                // let JsSIP know to await for our callback. await returns a function we call when we're done.
                let finished = data.await();
                sdpMunger.restartPC(data, rtcSession.connection, function () {
                    logger.debug('Sucessfully restarted PC stream');
                    statsManager.processSdp(data);
                    sdpMunger.mungeRemote(data);
                    finished();
                    handlers.notify('pc_state', pcstate);
                }, function () {
                    logger.error('Failed to restart PC stream');
                });
                return;
            }
            else {
                statsManager.processSdp(data);
                sdpMunger.mungeRemote(data);
                handlers.notify('pc_state', pcstate);
            }
        }
    };
    let onIceChange = function (event) {
        let pc = event.target;
        let ice = {
            gatheringState: pc.iceGatheringState,
            connectionState: pc.iceConnectionState,
            signalingState: pc.signalingState
        };
        logger.debug('Ice event: ', ice);
        let finalConnState = 'completed';
        if (sl.detectedBrowser === 'firefox') {
            finalConnState = 'connected';
        }
        if (ice.gatheringState === 'complete' &&
            ice.connectionState === finalConnState &&
            renegotiate &&
            !renegotiateInProgress) {
            renegotiateInProgress = true;
            sdpMunger.onIceComplete(rtcSession.connection, audioOnlyCall, function () {
                let mutestatus = rtcSession.isMuted();
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
    let muteStatus;
    let dial = function (local_stream) {
        if (!local_stream)
            throw 'Local media stream is a required parameter';
        if (local_stream.getAudioTracks().length !== 1)
            throw 'Local stream must have exactly 1 audio track';
        if (local_stream.getVideoTracks().length > 1)
            throw 'Local stream must have 0 or 1 video tracks';
        if (local_stream.getVideoTracks().length === 1) {
            let settings = local_stream.getVideoTracks()[0].getSettings();
            if (!settings.width || settings.width > 1280)
                throw 'Video track width > 1280px';
            if (!settings.height || settings.height > 720)
                throw 'Video track height > 720px';
        }
        let jssip_config = {
            uri: 'unknown@' + config.org_domain,
            sockets: [
                new JsSIP.WebSocketInterface('wss://' + config.org_domain + ':' + config.websocket_port)
            ],
            display_name: config.display_name,
            register: false,
            session_timers: false
        };
        endReason = null;
        callEnding = false;
        logger.info('Dialling: ', config.target);
        userAgent = new JsSIP.UA(jssip_config);
        userAgent.on('connected', function () {
            logger.info('Useragent connected');
            handlers.notify('ringing');
            callConnected(local_stream);
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
                    handlers.notify('add_stream', ev.stream);
                };
                event.peerconnection.onremovestream = function (ev) {
                    handlers.notify('remove_stream', ev.stream);
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
    };
    let callConnected = function (local_stream) {
        window.clearTimeout(connectionTimeout);
        connected_ws = true;
        let options = {
            rtcOfferConstraints: {
                offerToReceiveAudio: 1,
                offerToReceiveVideo: 1
            },
            mediaStream: local_stream
        };
        logger.info('Sending sip invite to ', config.target, ' with options ', options.rtcOfferConstraints);
        sdpMunger.setLocalMedia(options.mediaStream);
        userAgent.call('sip:' + config.target, options);
    };
    let confirmed = function () {
        logger.debug('Call confirmed - going to in_call state');
        mute(muteStatus);
        handlers.notify('in_call');
    };
    let finishedRenegotiation = function () {
        logger.debug('Finished renegotiation');
        renegotiateInProgress = false;
        renegotiate = false;
        handlers.notify('renegotiated');
    };
    // this isn't called when the use hangs up.
    let translateSipEvent = function (event) {
        let r = interface_1.CallEndReason;
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
    let shutdown = function () {
        statsManager.stop();
        sdpMunger.stop();
        if (rtcSession) {
            rtcSession.unmute({ audio: true, video: true });
        }
        window.clearTimeout(connectionTimeout);
    };
    let hangup = function () {
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
    let onCallError = function (jssipEvent) {
        shutdown();
        logger.debug('RTC session has ended');
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
    let userAgentDisconnect = function (event) {
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
    let mute = function (media) {
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
            let localstreams = rtcSession.connection.getLocalStreams();
            if (localstreams.length > 1) {
                let vtracks = localstreams[1].getVideoTracks();
                for (let i = 0; i < vtracks.length; i++) {
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
    let isMuted = function () {
        if (rtcSession) {
            return rtcSession.isMuted();
        }
        else {
            return { audio: false, video: false };
        }
    };
    let screenSenders = [];
    let canSwitchStreams = function (stream) {
        return rtcSession && stream && rtcSession.connection.signalingState !== 'closed';
    };
    let addPCStream = function (stream) {
        if (stream.getAudioTracks().length !== 0)
            throw 'PC stream must have no audio track';
        if (stream.getVideoTracks().length > 1)
            throw 'PC stream must have 0 or 1 video tracks';
        if (stream.getVideoTracks().length === 1) {
            let settings = stream.getVideoTracks()[0].getSettings();
            if (!settings.width || settings.width > 1920)
                throw 'Video track width > 1920px';
            if (!settings.height || settings.height > 1088)
                throw 'Video track height > 1088px';
        }
        if (canSwitchStreams(stream)) {
            let audio_tracks = stream.getAudioTracks();
            if (audio_tracks.length > 0) {
                logger.error('PC stream has audio track');
            }
            if (sl.detectedBrowser === 'firefox') {
                stream.getTracks().forEach(function (track) {
                    let sender = rtcSession.connection.addTrack(track, stream);
                    screenSenders.push(sender);
                });
            }
            else {
                rtcSession.connection.addStream(stream);
            }
        }
    };
    let removePCStream = function (stream) {
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
    let that = {
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
