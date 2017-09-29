import * as sl from '../sl';
import { ILogger } from '../sl';
import * as JsSIP from 'jssip-sl';
import { PCState, CallEndReason, MuteState } from './constants';
import { StatsManager } from './stats_manager';
import { SdpMunger, SdpData } from './sdp_munger';

const statsPeriod = 10000;

export type CallEvent =
    | 'ringing'
    | 'in_call'
    | 'renegotiated'
    | 'audioonly'
    | 'addstream'
    | 'removestream'
    | 'pluginVideoMute'
    | 'pcstate'
    | 'ending'
    | 'ended';

type CallEventHandlers = {
    [k in CallEvent]: {
        cb: any;
        oneshot: boolean;
    }
};

export interface CallOptions {
    mediaConstraints?: MediaStreamConstraints;
    mediaStream?: MediaStream;
    rtcOfferConstraints?: RTCOfferOptions;
}

export function SlCall(config: any, base_logger: ILogger, logSdp: boolean) {
    let logger = base_logger.sub('CALL-' + config.call_number);
    let plugin = config.plugin;
    let statsManager = StatsManager(statsPeriod, logger);
    let endReason: CallEndReason | null = null;

    if (!config.display_name) {
        throw 'missing display name';
    } else if (config.display_name.length > 100) {
        logger.debug('User name too long, trimming to 100 characters');
        config.display_name = config.display_name.slice(0, 100);
    }
    let handlers = (function() {
        let reg: CallEventHandlers = {
            ringing: { cb: null, oneshot: true }, // no args
            in_call: { cb: null, oneshot: true },
            renegotiated: { cb: null, oneshot: true },
            audioonly: { cb: null, oneshot: false }, // { bool isAudioOnly - true if the call will only have audio }
            addstream: { cb: null, oneshot: false }, // remote MediaStream object
            removestream: { cb: null, oneshot: false }, // remote MediaStream object
            pluginVideoMute: { cb: null, oneshot: false },
            pcstate: { cb: null, oneshot: false },
            ending: { cb: null, oneshot: true },
            ended: { cb: null, oneshot: true } // one CallEndReason will be returned
        };
        // ending is useful for users who want to display things before the call has ended

        let setHandler = function(event: CallEvent, handler: any) {
            reg[event].cb = handler;
        };

        let notify = function(event: CallEvent, ...args: any[]) {
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

    let userAgent: JsSIP.UA;
    let rtcSession: JsSIP.RtcSession;
    let callEnding = true;

    let renegotiate = true;
    let renegotiateInProgress = false;
    let connectionTimeout: number = -1; // If we don't connect a websocket within 10 seconds, fail the call

    let sdpMunger = SdpMunger(logger, logSdp, plugin, config.allowH264);
    let audioOnlyCall = false;
    let connected_ws = false;

    let onSdp = function(data: SdpData) {
        if (data.originator === 'remote') {
            logger.info('Receiving SDP');
        } else {
            logger.info('Sending SDP');
        }
        let isAudioOnly = sdpMunger.isAudioOnly(data.sdp);
        if (data.originator === 'remote' && isAudioOnly !== audioOnlyCall) {
            handlers.notify('audioonly', isAudioOnly); //only notify when the audio only status of the call changes
            audioOnlyCall = isAudioOnly;
        }
        if (data.originator === 'local') {
            sdpMunger.mungeLocal(data);
            statsManager.processSdp(data); // always process stats in unified plan form
            handlers.notify('pcstate', sdpMunger.getPcState(data));
        } else {
            let pcstate = sdpMunger.getPcState(data);
            if (pcstate === PCState.RECV && data.type === 'offer' && plugin) {
                // let JsSIP know to await for our callback. await returns a function we call when we're done.
                let finished = data.await();
                sdpMunger.restartPC(
                    data,
                    rtcSession.connection,
                    function() {
                        logger.debug('Sucessfully restarted PC stream');
                        statsManager.processSdp(data);
                        sdpMunger.mungeRemote(data);
                        finished();
                        handlers.notify('pcstate', pcstate);
                    },
                    function() {
                        logger.error('Failed to restart PC stream');
                    }
                );
                return;
            } else {
                statsManager.processSdp(data);
                sdpMunger.mungeRemote(data);
                handlers.notify('pcstate', pcstate);
            }
        }
    };

    let onIceChange = function(event: Event) {
        let pc = event.target as RTCPeerConnection;
        let ice = {
            gatheringState: pc.iceGatheringState,
            connectionState: pc.iceConnectionState,
            signalingState: pc.signalingState
        };
        logger.debug('Ice event: ', ice);
        let finalConnState = 'completed';
        if (sl.getBrowser() === 'firefox') {
            finalConnState = 'connected';
        }
        if (
            ice.gatheringState === 'complete' &&
            ice.connectionState === finalConnState &&
            renegotiate &&
            !renegotiateInProgress
        ) {
            renegotiateInProgress = true;
            sdpMunger.onIceComplete(rtcSession.connection, audioOnlyCall, function() {
                let mutestatus = rtcSession.isMuted();
                rtcSession.renegotiate({}, function() {
                    finishedRenegotiation();
                    mute(mutestatus);
                });
            });
        } else if (ice.connectionState === 'failed') {
            logger.error('Ice connection state failed - ending the call');
            endReason = CallEndReason.ICE_FAILURE;
            onCallError();
        }
    };
    let muteStatus: MuteState;

    let userCall = function(target: string, options: any) {
        config.sockets = [new JsSIP.WebSocketInterface(config.websocket_addr)];
        endReason = null;
        callEnding = false;
        logger.info('UserCall to: ', target);
        if (target && (options.mediaConstraints || options.mediaStream)) {
            userAgent = new JsSIP.UA(config);
            userAgent.on('connected', function() {
                logger.info('Useragent connected');
                handlers.notify('ringing');
                callConnected(target, options);
            });

            userAgent.on('disconnected', function(event) {
                logger.info('Useragent disconnected');
                userAgentDisconnect(event);
            });
            userAgent.on('newRTCSession', function(e) {
                rtcSession = e.session as JsSIP.RtcSession;
                muteStatus = rtcSession.isMuted();
                logger.info('Initial mute status = ', muteStatus);
                rtcSession.on('sending', function(event) {
                    let sip_call_id = config.call_number + '@' + config.suid;
                    event.request.setHeader('call-id', sip_call_id);
                });
                rtcSession.on('ended', function(event) {
                    logger.debug('RtcSession ended');
                    onCallError(event);
                });
                rtcSession.on('failed', function(event) {
                    logger.warn('RtcSession failure');
                    onCallError(event);
                });
                rtcSession.on('confirmed', function() {
                    logger.info('RtcSession confirmed');
                    confirmed();
                });
                rtcSession.on('peerconnection', function(event: {
                    peerconnection: RTCPeerConnection;
                }) {
                    statsManager.start(event.peerconnection);
                    logger.info('RtcSession peerConnection created');
                    event.peerconnection.onaddstream = function(ev) {
                        handlers.notify('addstream', ev.stream);
                    };
                    event.peerconnection.onremovestream = function(ev) {
                        handlers.notify('removestream', ev.stream);
                    };
                    event.peerconnection.oniceconnectionstatechange = function(ev) {
                        onIceChange(ev);
                    };
                    event.peerconnection.onnegotiationneeded = function() {
                        muteStatus = rtcSession.isMuted();
                        rtcSession.renegotiate({}, function() {
                            mute(muteStatus);
                        });
                    };
                });
                rtcSession.on('sdp', function(event) {
                    onSdp(event);
                });
                rtcSession.on('reinvite', function(event) {
                    logger.info('Reinvite');
                    muteStatus = rtcSession.isMuted();
                    event.callback = function() {
                        logger.info('Reinvite finished');
                        mute(muteStatus);
                    };
                });
            });
            userAgent.start();
            connectionTimeout = window.setTimeout(function() {
                logger.warn('WS connection timed out trying to connect');
                endReason = CallEndReason.CONNECTION_TIMEOUT;
                onCallError();
            }, 10000);
        } else {
            throw 'Missing required parameters to make the slCall!';
        }
    };

    let callConnected = function(target: string, options: CallOptions) {
        window.clearTimeout(connectionTimeout);
        connected_ws = true;
        options.rtcOfferConstraints = {
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 1
        };
        logger.info(
            'Sending sip invite to ',
            target,
            ' with options ',
            options.rtcOfferConstraints
        );
        if (!options.mediaStream) {
            let canvas = document.getElementById('canvas_vid') as HTMLCanvasElement;
            let ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            ctx.beginPath();
            ctx.rect(0, 0, 1280, 720);
            ctx.fillStyle = 'black';
            ctx.fill();
            if ((canvas as any).captureStream) {
                options.mediaStream = (canvas as any).captureStream(5);
            } else if ((canvas as any).mozCaptureStream) {
                options.mediaStream = (canvas as any).mozCaptureStream(5);
            }
            if (options.mediaStream) {
                logger.info('Created dummy media stream from canvas element.');
            }
        }
        sdpMunger.setLocalMedia(options.mediaStream);
        userAgent.call('sip:' + target, options);
    };

    let confirmed = function() {
        logger.debug('Call confirmed - going to in_call state');
        mute(muteStatus);
        handlers.notify('in_call');
    };

    let finishedRenegotiation = function() {
        logger.debug('Finished renegotiation');
        renegotiateInProgress = false;
        renegotiate = false;
        handlers.notify('renegotiated');
    };

    // this isn't called when the use hangs up.
    let translateSipEvent = function(event: any) {
        let r = CallEndReason;
        if (event && event.originator && event.cause) {
            if (event.cause === JsSIP.C.causes.CANCELED) {
                return r.INTERNAL_ERROR;
            } else if (event.cause === JsSIP.C.causes.CONNECTION_ERROR) {
                return r.CONNECTION_ERROR;
            } else if (event.cause === JsSIP.C.causes.BYE) {
                if (event.originator === 'remote') {
                    return r.REMOTE_BYE;
                } else {
                    return r.USER_BYE;
                }
            } else if (event.cause === JsSIP.C.causes.NOT_FOUND) {
                return r.NOT_FOUND;
            } else if (event.cause === JsSIP.C.causes.REQUEST_TIMEOUT) {
                return r.SIP_ERROR;
            } else if (event.cause === JsSIP.C.causes.REJECTED) {
                return r.REJECTED;
            } else if (event.cause === JsSIP.C.causes.BUSY) {
                return r.BUSY;
            } else if (event.cause === JsSIP.C.causes.SIP_FAILURE_CODE) {
                return r.SIP_ERROR;
            } else if (event.cause === JsSIP.C.causes.UNAVAILABLE) {
                return r.UNAVAILABLE;
            } else {
                return r.INTERNAL_ERROR;
            }
        } else {
            logger.error('Unknown error in call');
            return r.INTERNAL_ERROR;
        }
    };

    let shutdown = function() {
        statsManager.stop();
        sdpMunger.stop();
        if (rtcSession) {
            rtcSession.unmute({ audio: true, video: true });
        }
        window.clearTimeout(connectionTimeout);
    };

    let hangup = function() {
        shutdown();
        logger.debug('Hangup');
        handlers.notify('ending');
        if (renegotiateInProgress) {
            //if we've started the reinvite process, give it some time to complete.
            //it is invalid to send a bye whilst awaiting a response
            //but don't wait forever
            window.setTimeout(function() {
                renegotiateInProgress = false;
                hangup();
            }, 1000);
        } else {
            endReason = CallEndReason.USER_BYE;
            try {
                userAgent.stop();
            } catch (ex) {
                logger.warn('Exception stopping user agent after user hangup ', ex);
            }
        }
    };

    let onCallError = function(jssipEvent?: string) {
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
            } catch (ex) {
                logger.warn('Exception stopping user agent after rtcSession ended/failed ', ex);
            }
            if (!endReason && jssipEvent) {
                endReason = translateSipEvent(jssipEvent);
            }
        }
    };

    let userAgentDisconnect = function(event: any) {
        shutdown();
        if (event && event.code !== 1000 && !callEnding) {
            handlers.notify('ending');
            logger.warn('Websocket closed - ending call. ws event: ', event);
            try {
                userAgent.stop();
            } catch (ex) {
                logger.warn('Exception stopping user agent after disconnect ', ex);
            }
        }
        if (!endReason) {
            if (connected_ws) {
                logger.error('WS connection unexpected error');
                endReason = CallEndReason.CONNECTION_ERROR;
            } else {
                logger.error('WS connection refused');
                endReason = CallEndReason.CONNECTION_REFUSED;
            }
        }
        handlers.notify('ended', endReason);
    };

    let mute = function(media: MuteState): boolean {
        if (rtcSession) {
            if (typeof media.audio === 'boolean') {
                if (media.audio) {
                    logger.info('Muting audio');
                    rtcSession.mute({ audio: true });
                } else {
                    logger.info('Unmuting audio');
                    rtcSession.unmute({ audio: true });
                }
            }
            if (typeof media.video === 'boolean') {
                if (media.video) {
                    logger.info('Muting video');
                    rtcSession.mute({ video: true });
                } else {
                    logger.info('Unmuting video');
                    rtcSession.unmute({ video: true });
                }
                if (plugin) {
                    handlers.notify('pluginVideoMute', media.video);
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
        } else {
            return false;
        }
    };

    let isMuted = function(): MuteState {
        if (rtcSession) {
            return rtcSession.isMuted();
        } else {
            return { audio: false, video: false };
        }
    };

    let screenSenders: any[] = [];

    let canSwitchStreams = function(stream: MediaStream): boolean {
        return rtcSession && stream && rtcSession.connection.signalingState !== 'closed';
    };

    let addPCStream = function(stream: MediaStream) {
        if (canSwitchStreams(stream)) {
            let audio_tracks = stream.getAudioTracks();
            if (audio_tracks.length > 0) {
                logger.error('PC stream has audio track');
            }
            if (sl.getBrowser() === 'firefox') {
                stream.getTracks().forEach(function(track) {
                    let sender = (rtcSession.connection as any).addTrack(track, stream);
                    screenSenders.push(sender);
                });
            } else {
                rtcSession.connection.addStream(stream);
            }
        }
    };

    let removePCStream = function(stream: MediaStream) {
        if (canSwitchStreams(stream)) {
            stream.getTracks().forEach(function(track) {
                track.stop();
            });
            if (sl.getBrowser() === 'firefox') {
                screenSenders.forEach(function(sender) {
                    (rtcSession.connection as any).removeTrack(sender);
                });
            } else {
                rtcSession.connection.removeStream(stream);
            }
        }
    };

    let that = {
        on: handlers.setHandler,
        dial: userCall,
        hangup: hangup,
        mute: mute,
        isMuted: isMuted,
        addPCStream: addPCStream,
        removePCStream: removePCStream
    };
    return that;
}
