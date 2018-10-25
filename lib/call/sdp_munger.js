"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SdpInterop = require("sdp-interop-sl");
const interface_1 = require("./interface");
const codecs = require("./sdp_codecs");
function SdpMunger(base_logger, logSdp) {
    let max_bps_without_bwe = 512 * 1000;
    let bwe_enabled = true;
    let logger = base_logger.sub("SDP");
    function deepCopy(thing) {
        return JSON.parse(JSON.stringify(thing));
    }
    let parseSdp = SdpInterop.transform.parse;
    let writeSdp = SdpInterop.transform.write;
    // mline protocol must always match the offer.
    let localOfferProtocols = [];
    let remoteOfferProtocols = [];
    let tcpMedia = false;
    let log;
    if (logSdp) {
        log = function (...args) {
            logger.debug(...args);
        };
    }
    else {
        log = function () { };
    }
    function checkContent(invalids, contentType) {
        if (typeof invalids !== "undefined") {
            for (let i = 0; i < invalids.length; i++) {
                if (invalids[i].value === "content:" + contentType) {
                    return true;
                }
            }
        }
        return false;
    }
    let mungeBandwidth = function (session) {
        let videoLine = null;
        let pcLine = null;
        session.media.forEach(function (line) {
            if (line.type === "video" && typeof line.invalid !== "undefined") {
                if (checkContent(line.invalid, "main")) {
                    videoLine = line;
                }
                else if (line.direction === "recvonly" && checkContent(line.invalid, "slides")) {
                    pcLine = line;
                }
                if (line.rtcpFb && line.bandwidth) {
                    bwe_enabled = line.rtcpFb.some(function (fb) {
                        return fb.type === "goog-remb";
                    });
                    if (!bwe_enabled) {
                        line.bandwidth[0].limit = max_bps_without_bwe;
                    }
                }
            }
        });
    };
    let mungeRemote = function (data) {
        if (data.originator !== "remote") {
            throw "local sdp input into mungeRemote";
        }
        log("recv u plan", deepCopy(data.sdp));
        let session = parseSdp(data.sdp);
        if (data.type === "offer") {
            remoteOfferProtocols = [];
        }
        session.media.forEach(function (mline, index, media) {
            if (mline.type === "audio") {
                tcpMedia = mline.protocol === "TCP/DTLS/RTP/SAVPF";
                if (tcpMedia) {
                    logger.info("Using TCP media");
                }
            }
            if (data.type === "offer") {
                remoteOfferProtocols.push(mline.protocol);
                if (localOfferProtocols.length > index) {
                    mline.protocol = localOfferProtocols[index];
                }
            }
            else {
                mline.protocol = localOfferProtocols[index];
            }
            if (mline.port != 0) {
                if (index > 0) {
                    if (!mline.icePwd) {
                        mline.icePwd = media[index - 1].icePwd;
                    }
                    if (!mline.iceUfrag) {
                        mline.iceUfrag = media[index - 1].iceUfrag;
                    }
                }
                if (mline.type === "video") {
                    codecs.hackH264Level(mline, log);
                }
            }
            else {
                mline.direction = "inactive";
            }
        });
        mungeBandwidth(session);
        data.sdp = writeSdp(session);
    };
    let mungeLocal = function (data) {
        if (data.originator !== "local") {
            throw "remote sdp input into mungeLocal";
        }
        let session = parseSdp(data.sdp);
        session.media.forEach(function (mline, index) {
            let bundle_only = mline.invalid && mline.invalid.find((obj) => obj.value === "bundle-only");
            let in_bundle = session.groups[0].mids.indexOf(mline.mid) !== -1;
            if (mline.port == 0 && (!bundle_only || !in_bundle)) {
                delete mline.rtcpMux;
                delete mline.direction;
            }
            else if (mline.direction === "inactive") {
                mline.port = 0;
                if (mline.invalid) {
                    mline.invalid = mline.invalid.filter((obj) => obj.value !== "bundle-only");
                }
                delete mline.rtcpMux;
                delete mline.direction;
            }
            if (mline.type === "video") {
                codecs.hackH264Params(mline, log);
            }
        });
        data.sdp = writeSdp(session);
        session = parseSdp(data.sdp);
        if (data.type === "offer") {
            localOfferProtocols = [];
        }
        let videoLines = 0;
        session.media.forEach(function (mline, index) {
            if (data.type === "offer") {
                localOfferProtocols.push(mline.protocol);
                if (tcpMedia) {
                    mline.protocol = "TCP/DTLS/RTP/SAVPF";
                }
                else {
                    mline.protocol = "UDP/TLS/RTP/SAVPF";
                }
            }
            else {
                mline.protocol = remoteOfferProtocols[index];
            }
            if (mline.type === "video") {
                if (!mline.invalid) {
                    mline.invalid = [];
                }
                if (videoLines++ === 0) {
                    mline.invalid.push({ value: "content:main" });
                    mline.invalid.push({ value: "label:video" });
                }
                else {
                    mline.invalid.push({ value: "content:slides" });
                    mline.invalid.push({ value: "label:pc" });
                }
            }
        });
        data.sdp = writeSdp(session);
        log("send uplan", deepCopy(data.sdp));
    };
    let isAudioOnly = function (sdp) {
        let session = parseSdp(sdp);
        if (session.media.length < 2) {
            return true;
        }
        return session.media[1].port === 0;
    };
    let getContentState = function (data) {
        let isLocal = data.originator === "local";
        let state = interface_1.ContentState.DISABLED;
        let session = parseSdp(data.sdp);
        let groups = session.groups;
        if (groups.length > 0) {
            let mids = groups[0].mids;
            session.media.forEach(function (mline) {
                if (mline.invalid && mline.invalid.length !== 0) {
                    mline.invalid.forEach(function (invalid) {
                        if (invalid.value === "content:slides") {
                            if (mline.port !== 0) {
                                if (isLocal) {
                                    if (mline.direction === "sendonly") {
                                        state = interface_1.ContentState.SEND;
                                    }
                                    else {
                                        state = interface_1.ContentState.RECV;
                                    }
                                }
                                else {
                                    if (mline.direction === "recvonly") {
                                        state = interface_1.ContentState.SEND;
                                    }
                                    else {
                                        state = interface_1.ContentState.RECV;
                                    }
                                }
                            }
                            else if (data.type === "offer") {
                                let in_bundle = mids.indexOf(mline.mid) !== -1;
                                let bundle_only = mline.invalid.some((obj) => {
                                    return obj.value === "bundle-only";
                                });
                                if (in_bundle && bundle_only) {
                                    state = interface_1.ContentState.SEND;
                                }
                            }
                        }
                    });
                }
            });
        }
        return state;
    };
    function disableContent(data) {
        let session = parseSdp(data.sdp);
        session.media.forEach(function (mline) {
            if (mline.invalid && mline.invalid.length !== 0) {
                mline.invalid.forEach(function (invalid) {
                    if (invalid.value === "content:slides") {
                        mline.port = 0;
                        mline.direction = "inactive";
                    }
                });
            }
        });
        data.sdp = writeSdp(session);
    }
    let that = {
        mungeRemote: mungeRemote,
        mungeLocal: mungeLocal,
        isAudioOnly: isAudioOnly,
        getContentState: getContentState,
        disableContent: disableContent
    };
    return that;
}
exports.SdpMunger = SdpMunger;
