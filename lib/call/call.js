"use strict";
// Using the WebRTC 1.0 standard - https://w3c.github.io/webrtc-pc
// Cut out the rtc_legacy version when all browsers that we support implement the WebRTC 1.0 spec.
Object.defineProperty(exports, "__esModule", { value: true });
const JsSIP = require("jssip-sl");
const sl = require("../sl");
const interface_1 = require("./interface");
const stats_manager_1 = require("./stats_manager");
const sdp_munger_1 = require("./sdp_munger");
const statsPeriod = 10000;
function Call(config_, base_logger, logSdp, media_stream) {
    let config = Object.assign({}, config_, { websocket_port: 443 });
    let logger = base_logger.sub("CALL");
    let stats_manager = stats_manager_1.StatsManager(statsPeriod, logger);
    let endReason = null;
    if (!config.display_name) {
        throw "missing display name";
    }
    else if (config.display_name.length > 100) {
        logger.debug("User name too long, trimming to 100 characters");
        config.display_name = config.display_name.slice(0, 100);
    }
    let handlers = (function () {
        let reg = {
            ringing: { cb: null, oneshot: true },
            in_call: { cb: null, oneshot: true },
            ice_reinvite_complete: { cb: null, oneshot: true },
            content_reinvite_complete: { cb: null, oneshot: false },
            audio_only: { cb: null, oneshot: false },
            remote_video: { cb: null, oneshot: false },
            remote_content: { cb: null, oneshot: false },
            local_content: { cb: null, oneshot: false },
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
    let user_agent;
    let rtc_session;
    let callEnding = true;
    let await_ice_reinvite = true;
    let connection_timeout_timer = -1; // If we don't connect a websocket within 10 seconds, fail the call
    let sdp_munger = sdp_munger_1.SdpMunger(logger, logSdp);
    let audio_only_call = false;
    let connected_ws = false;
    let mute_status;
    let local_av_stream = media_stream;
    let video_transceiver;
    let local_content_stream;
    let content_transceiver;
    let content_retry_timer = -1;
    // SIP calling code.
    function dial() {
        let jssip_cfg = {
            uri: "unknown@" + config.org_domain,
            display_name: config.display_name,
            register: false,
            session_timers: false,
            user_agent: "WebRTC " + sl.detectedBrowser + " " + sl.browser_version,
            sockets: [new JsSIP.WebSocketInterface("wss://" + config.org_domain + ":" + config.websocket_port)]
        };
        endReason = null;
        callEnding = false;
        logger.info("UserCall to: ", config.target);
        user_agent = new JsSIP.UA(jssip_cfg);
        user_agent.on("connected", function () {
            logger.info("Useragent connected");
            handlers.notify("ringing");
            callConnected();
        });
        user_agent.on("disconnected", userAgentDisconnect);
        user_agent.on("newRTCSession", e => {
            rtc_session = e.session;
            mute_status = isMuted();
            logger.info("Initial mute status = ", mute_status);
            rtc_session.on("ended", event => {
                logger.debug("RtcSession ended");
                onCallError(event);
            });
            rtc_session.on("failed", event => {
                logger.warn("RtcSession failure");
                onCallError(event);
            });
            rtc_session.on("confirmed", () => {
                logger.info("RtcSession confirmed");
                confirmed();
            });
            rtc_session.on("peerconnection", (event) => {
                setupPeerConnection(event.peerconnection);
            });
            rtc_session.on("sdp", event => {
                onSdp(event);
            });
            rtc_session.on("reinvite", event => {
                logger.info("Reinvite");
                mute_status = isMuted();
                event.callback = () => {
                    logger.info("Reinvite finished");
                    if (await_ice_reinvite) {
                        await_ice_reinvite = false;
                        handlers.notify("ice_reinvite_complete");
                    }
                    mute(mute_status);
                };
            });
        });
        user_agent.start();
        connection_timeout_timer = window.setTimeout(() => {
            logger.warn("WS connection timed out trying to connect");
            endReason = interface_1.CallEndReason.CONNECTION_TIMEOUT;
            onCallError();
        }, 10000);
    }
    function callConnected() {
        window.clearTimeout(connection_timeout_timer);
        connected_ws = true;
        let options = {};
        logger.info("Sending sip invite to ", config.target);
        // media transceivers will be set up by us, not JsSIP.
        user_agent.call("sip:" + config.target, {
            mediaConstraints: { audio: false, video: false }
        });
    }
    function confirmed() {
        logger.debug("Call confirmed - going to in_call state");
        mute(mute_status);
        handlers.notify("in_call");
    }
    // this isn't called when the use hangs up.
    function translateSipEvent(event) {
        let r = interface_1.CallEndReason;
        if (event && event.originator && event.cause) {
            if (event.cause === JsSIP.C.causes.CANCELED) {
                return r.INTERNAL_ERROR;
            }
            else if (event.cause === JsSIP.C.causes.CONNECTION_ERROR) {
                return r.CONNECTION_ERROR;
            }
            else if (event.cause === JsSIP.C.causes.BYE) {
                if (event.originator === "remote") {
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
            logger.error("Unknown error in call");
            return r.INTERNAL_ERROR;
        }
    }
    function shutdown() {
        stats_manager.stop();
        if (rtc_session) {
            rtc_session.unmute({ audio: true, video: true });
        }
        window.clearTimeout(connection_timeout_timer);
    }
    function hangup() {
        shutdown();
        logger.debug("Hangup");
        handlers.notify("ending");
        endReason = interface_1.CallEndReason.USER_BYE;
        try {
            user_agent.stop();
        }
        catch (ex) {
            logger.warn("Exception stopping user agent after user hangup ", ex);
        }
    }
    function onCallError(jssipEvent) {
        shutdown();
        logger.debug("Rtc session has ended");
        if (jssipEvent) {
            logger.debug("Due to ", jssipEvent);
        }
        handlers.notify("ending");
        if (!callEnding) {
            callEnding = true;
            try {
                user_agent.stop();
            }
            catch (ex) {
                logger.warn("Exception stopping user agent after rtcSession ended/failed ", ex);
            }
            if (endReason === null && jssipEvent) {
                endReason = translateSipEvent(jssipEvent);
            }
        }
    }
    function userAgentDisconnect(event) {
        shutdown();
        if (event && event.code !== 1000 && !callEnding) {
            handlers.notify("ending");
            logger.warn("Websocket closed - ending call. ws event: ", event);
            try {
                user_agent.stop();
            }
            catch (ex) {
                logger.warn("Exception stopping user agent after disconnect ", ex);
            }
        }
        if (endReason === null) {
            if (connected_ws) {
                logger.error("WS connection unexpected error");
                endReason = interface_1.CallEndReason.CONNECTION_ERROR;
            }
            else {
                logger.error("WS connection refused");
                endReason = interface_1.CallEndReason.CONNECTION_REFUSED;
            }
        }
        handlers.notify("ended", endReason);
    }
    function mute(set_mute) {
        if (rtc_session && local_av_stream) {
            let mute_status_old = isMuted();
            local_av_stream.getAudioTracks()[0].enabled = !set_mute.audio;
            logger.info("Audio " + (set_mute.audio ? "Muted" : "Unmuted"));
            if (local_av_stream.getVideoTracks().length !== 0) {
                local_av_stream.getVideoTracks()[0].enabled = !set_mute.video;
                logger.info("Video " + (set_mute.video ? "Muted" : "Unmuted"));
            }
            mute_status = isMuted();
            if (mute_status.video !== mute_status_old.video) {
                rtc_session.sendInfo("application/media_control+xml", "<stream_id>video</stream_id>" + "<mute>" + (mute_status.video ? 1 : 0) + "</mute>");
            }
            return true;
        }
        else {
            return false;
        }
    }
    function isMuted() {
        if (!local_av_stream) {
            return { audio: false, video: false };
        }
        let audio_mute = !local_av_stream.getAudioTracks()[0].enabled;
        let video_mute = false;
        let video_tracks = local_av_stream.getVideoTracks();
        if (video_tracks.length !== 0) {
            video_mute = !video_tracks[0].enabled;
        }
        return {
            audio: audio_mute,
            video: video_mute
        };
    }
    // RTCPeerConnection code
    function onIceChange(event) {
        let pc = event.target;
        let ice = {
            gatheringState: pc.iceGatheringState,
            connectionState: pc.iceConnectionState,
            signalingState: pc.signalingState
        };
        logger.debug("Ice event: ", ice);
        let finalConnState = "completed";
        if (sl.browser_name === "firefox") {
            finalConnState = "connected";
        }
        if (ice.gatheringState === "complete" && ice.connectionState === finalConnState) {
            logger.info("ICE completed locally");
        }
        if (ice.connectionState === "failed") {
            logger.error("Ice connection state failed - ending the call");
            endReason = interface_1.CallEndReason.ICE_FAILURE;
            onCallError();
        }
    }
    function setupPeerConnection(pc) {
        logger.info("RtcSession peerConnection created");
        if (local_av_stream) {
            pc.addTransceiver(local_av_stream.getAudioTracks()[0], {
                direction: "sendrecv",
                streams: [local_av_stream]
            });
            if (local_av_stream.getVideoTracks().length === 1) {
                video_transceiver = pc.addTransceiver(local_av_stream.getVideoTracks()[0], {
                    direction: "sendrecv",
                    streams: [local_av_stream]
                });
            }
            else {
                video_transceiver = pc.addTransceiver("video", { direction: "recvonly" });
            }
        }
        else {
            // necessary to set audio to sendrecv for CC reasons
            pc.addTransceiver("audio", { direction: "sendrecv" });
            video_transceiver = pc.addTransceiver("video", { direction: "recvonly" });
        }
        pc.ontrack = (ev) => {
            let stream = ev.streams[0];
            if (stream.id === "sl-video-stream") {
                handlers.notify("remote_video", stream);
                if (ev.track.kind === "video") {
                    video_transceiver = ev.transceiver;
                    if (local_av_stream && local_av_stream.getVideoTracks().length === 1) {
                        let local_vid_track = local_av_stream.getVideoTracks()[0];
                        if (video_transceiver.sender.track !== local_vid_track) {
                            video_transceiver.sender.replaceTrack(local_vid_track);
                            video_transceiver.direction = "sendrecv";
                        }
                    }
                    ev.track.onended = () => {
                        video_transceiver = undefined;
                    };
                }
            }
            else if (stream.id === "sl-pc-stream") {
                handlers.notify("remote_content", stream);
                ev.track.onended = () => {
                    if (!local_content_stream) {
                        content_transceiver = undefined;
                    }
                    handlers.notify("remote_content", undefined);
                };
                content_transceiver = ev.transceiver;
            }
        };
        pc.oniceconnectionstatechange = function (ev) {
            onIceChange(ev);
        };
        pc.onnegotiationneeded = function () {
            mute_status = isMuted();
            rtc_session.renegotiate({}, function () {
                mute(mute_status);
            });
        };
        stats_manager.start(pc);
    }
    function startContent(stream) {
        window.clearTimeout(content_retry_timer);
        content_retry_timer = -1;
        if (!rtc_session) {
            logger.error("Cannot start content, RTC session has ended");
            return;
        }
        if (!rtc_session.isReadyToReOffer()) {
            logger.debug("Cannot start content, SIP negotiation in progress, retrying in 500ms");
            content_retry_timer = window.setTimeout(() => startContent(stream), 500);
            return;
        }
        let peerConnection = rtc_session.connection;
        if (content_transceiver && !content_transceiver.stopped) {
            content_transceiver.sender.replaceTrack(stream.getVideoTracks()[0]);
            local_content_stream = stream;
            content_transceiver.direction = "sendonly";
        }
        else {
            content_transceiver = peerConnection.addTransceiver(stream.getVideoTracks()[0], {
                direction: "sendonly",
                streams: [stream]
            });
            local_content_stream = stream;
        }
        local_content_stream.getVideoTracks()[0].onended = () => endContent();
        logger.debug("Started content");
        handlers.notify("local_content", stream);
        rtc_session.renegotiate({}, () => {
            logger.debug("Renegotiation after starting content complete");
            handlers.notify("content_reinvite_complete");
        });
    }
    function endContent() {
        window.clearTimeout(content_retry_timer);
        content_retry_timer = -1;
        if (!rtc_session) {
            logger.debug("Call already ended");
            return;
        }
        if (!local_content_stream) {
            logger.warn("Cannot end content, no content stream to end");
            return;
        }
        if (!rtc_session.isReadyToReOffer()) {
            logger.debug("Cannot remove content, SIP negotiation in progress, retrying in 500ms");
            content_retry_timer = window.setTimeout(() => endContent(), 500);
            return;
        }
        let peerConnection = rtc_session.connection;
        if (content_transceiver && !content_transceiver.stopped) {
            peerConnection.removeTrack(content_transceiver.sender);
            content_transceiver.direction = "inactive";
        }
        local_content_stream.getVideoTracks()[0].stop();
        content_transceiver = undefined;
        local_content_stream = undefined;
        logger.debug("Ended content");
        handlers.notify("local_content", undefined);
        rtc_session.renegotiate({}, () => {
            logger.debug("Renegotiation after ending content complete");
            handlers.notify("content_reinvite_complete");
        });
    }
    function onSdp(data) {
        if (data.originator === "remote") {
            logger.info("Receiving SDP");
        }
        else {
            logger.info("Sending SDP");
        }
        let audio_only = sdp_munger.isAudioOnly(data.sdp);
        if (data.originator === "remote" && audio_only !== audio_only_call) {
            handlers.notify("audio_only", audio_only); //only notify when the audio-only status of the call changes
            audio_only_call = audio_only;
        }
        if (data.originator === "local") {
            sdp_munger.mungeLocal(data);
            stats_manager.processSdp(data);
        }
        else {
            let content_state = sdp_munger.getContentState(data);
            if (data.type === "offer") {
                if (content_state === interface_1.ContentState.RECV && content_transceiver && local_content_stream) {
                    content_transceiver.direction = "recvonly";
                    local_content_stream.getVideoTracks()[0].stop();
                    local_content_stream = undefined;
                    logger.debug("Switching transceiver to remote content");
                    handlers.notify("local_content", undefined);
                }
                else if (content_state === interface_1.ContentState.SEND && !local_content_stream) {
                    logger.error("StarLeaf offered to receive content when WebRTC is not sending");
                    sdp_munger.disableContent(data);
                }
                else if (content_state === interface_1.ContentState.DISABLED && local_content_stream) {
                    // remote side switched content off in an offer
                    local_content_stream.getVideoTracks()[0].stop();
                    content_transceiver = undefined;
                    local_content_stream = undefined;
                    logger.debug("Remote offer disabled content");
                    handlers.notify("local_content", undefined);
                }
            }
            else {
                if (content_state === interface_1.ContentState.DISABLED && local_content_stream) {
                    // remote side switched content off in an answer
                    local_content_stream.getVideoTracks()[0].stop();
                    content_transceiver = undefined;
                    local_content_stream = undefined;
                    logger.debug("Remote answer disabled content");
                    handlers.notify("local_content", undefined);
                }
            }
            stats_manager.processSdp(data);
            sdp_munger.mungeRemote(data);
        }
    }
    let that = {
        on: handlers.setHandler,
        dial: dial,
        hangup: hangup,
        mute: mute,
        isMuted: isMuted,
        startContent: startContent,
        endContent: endContent
    };
    return that;
}
exports.Call = Call;
