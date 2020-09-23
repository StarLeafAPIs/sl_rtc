/*
* Copyright (c) StarLeaf Limited, 2017
*/

import * as SdpInterop from "sdp-interop-sl";
import { ILogger, detectedBrowser } from "../sl";
import { PCState, MediaType } from "./interface";
import * as sl from "../sl";
import { sprintf } from "sprintf-js";

export type Orginator = "remote" | "local";
export type SdpType = "offer" | "answer" | null;

export interface SdpData extends RTCSessionDescription {
    originator: Orginator;
    await: () => () => void;
}

type IceCandidates = { [k in Orginator]: any };

export function SdpMunger(base_logger: ILogger, logSdp: boolean, allowH264: boolean) {
    let min_video_bps = 200 * 1000;
    let max_bps_without_bwe = 512 * 1000;
    let bwe_enabled = true;

    let logger = base_logger.sub("SDP");
    let sdpinterop: any = null;
    let browser_name = detectedBrowser;

    let deepCopy = function(thing: any) {
        return JSON.parse(JSON.stringify(thing));
    };

    let parseSdp = SdpInterop.transform.parse;
    let writeSdp = SdpInterop.transform.write;

    let local_media: { [k in MediaType]: boolean } = {
        audio: false,
        video: false
    };

    // mline protocol must always match the offer.
    let localOfferProtocols: string[] = [];
    let remoteOfferProtocols: string[] = [];

    let tcpMedia = false;
    // we will parse this from the peer connection stats, and add them to the SDP.
    let candidate: IceCandidates = {
        local: null,
        remote: null
    };
    let statsTimeout: number = -1;
    let check_cands = function() {
        return candidate.local !== null && candidate.remote !== null;
    };

    let log: (...args: any[]) => void;
    if (logSdp) {
        log = function(...args: any[]) {
            logger.debug(...args);
        };
    } else {
        log = function() {};
    }

    let checkContent = function(invalids: any, contentType: string) {
        if (typeof invalids !== "undefined") {
            for (let i = 0; i < invalids.length; i++) {
                if (invalids[i].value === "content:" + contentType) {
                    return true;
                }
            }
        }
        return false;
    };
    // StarLeaf sends H.264 baseline profile - however our baseline obeys all the limitations of the
    // Constrained Baseline profile, so hack the required bit into the profile-level-id when receiving
    // SDP from StarLeaf
    let hackH264Level = function(mline: any) {
        if (mline.rtp) {
            mline.rtp.forEach(function(rtp: any) {
                if (rtp.codec === "H264" && mline.fmtp) {
                    for (let k = 0; k < mline.fmtp.length; k++) {
                        let fmtp = mline.fmtp[k];
                        if (fmtp.payload === rtp.payload) {
                            let params = fmtp.config.split(";");
                            for (let i = 0; i < params.length; i++) {
                                if (params[i].startsWith("profile-level-id")) {
                                    let profile = parseInt(params[i].split("=")[1].substr(0, 6), 16);
                                    if (profile & 0x420000) {
                                        profile |= 0x004000;
                                        log("hacked h264 profile level");
                                    } else {
                                        throw "H.264 profile is not baseline";
                                    }
                                    params[i] = "profile-level-id=" + profile.toString(16);
                                }
                            }
                            fmtp.config = params.join(";");
                        }
                    }
                }
            });
        }
    };
    // The Browser doesn't specify any of these params for its H.264, meaning we initialize its offer with the defaults
    // in the pbx. These are too low for 1080p, so screenshare fails. Hack them in here - the browser is perfectly
    // capable of receiving these parameters.
    let h264Params = [
        { key: "max-fs", value: 8192 },
        { key: "max-mbps", value: 245000 },
        { key: "max-dpb", value: 32768 }
    ];

    let hackH264Params = function(mline: any) {
        if (mline.rtp) {
            mline.rtp.forEach(function(rtp: any) {
                if (rtp.codec === "H264" && mline.fmtp) {
                    for (let k = 0; k < mline.fmtp.length; k++) {
                        let fmtp = mline.fmtp[k];
                        if (fmtp.payload === rtp.payload) {
                            let params = fmtp.config.split(";").map(function(param: string) {
                                let split = param.split("=");
                                return { key: split[0], value: split[1] };
                            });
                            h264Params.forEach(function(p) {
                                for (let i = 0; i < params.length; i++) {
                                    if (params[i].key === p.key) {
                                        params[i].value = p.value;
                                        return;
                                    }
                                }
                                params.push(p);
                            });
                            fmtp.config = params
                                .map(function(p: any) {
                                    return p.key + "=" + p.value;
                                })
                                .join(";");
                            log("hacked h264 fmtp ", fmtp);
                        }
                    }
                }
            });
        }
    };

    let removeH264 = function(mline: any) {
        log("removing h264 from mline");
        let new_rtp: string[] = [];
        let new_fmtp: string[] = [];
        let new_rtcpFb: string[] = [];
        let h264_payloads: string[] = [];
        if (mline.rtp) {
            mline.rtp.forEach(function(rtp: any) {
                if (rtp.codec !== "H264") {
                    new_rtp.push(rtp);
                } else {
                    h264_payloads.push(rtp.payload);
                }
            });
        }
        if (mline.fmtp) {
            mline.fmtp.forEach(function(fmtp: any) {
                if (h264_payloads.indexOf(fmtp.payload) === -1) {
                    new_fmtp.push(fmtp);
                }
            });
        }
        if (mline.rtcpFb) {
            mline.rtcpFb.forEach(function(rtcpFb: any) {
                if (h264_payloads.indexOf(rtcpFb.payload) === -1) {
                    new_rtcpFb.push(rtcpFb);
                }
            });
        }
        mline.rtp = new_rtp;
        mline.fmtp = new_fmtp;
        mline.rtcpFb = new_rtcpFb;
        if (mline.payloads && typeof mline.payloads === "string") {
            let payloads: any[] = [];
            mline.payloads.split(" ").forEach(function(pt: any) {
                if (h264_payloads.indexOf(String(pt)) === -1) {
                    payloads.push(pt);
                }
            });
            mline.payloads = payloads.join(" ");
        }
    };

    let mungeBandwidth = function(session: any) {
        let videoLine: any = null;
        let pcLine: any = null;
        session.media.forEach(function(line: any) {
            if (line.type === "video" && typeof line.invalid !== "undefined") {
                if (checkContent(line.invalid, "main")) {
                    videoLine = line;
                } else if (line.direction === "recvonly" && checkContent(line.invalid, "slides")) {
                    pcLine = line;
                }
                if (line.rtcpFb && line.bandwidth) {
                    bwe_enabled = line.rtcpFb.some(function(fb: any) {
                        return fb.type === "goog-remb";
                    });
                    if (!bwe_enabled) {
                        logger.info(
                            sprintf("bwe disabled, hard capping send bandwidth to %d kbps", max_bps_without_bwe / 1000)
                        );
                        line.bandwidth[0].limit = max_bps_without_bwe;
                    }
                }
            }
        });
        if (videoLine && pcLine) {
            if (videoLine.bandwidth && pcLine.bandwidth) {
                let video_b = videoLine.bandwidth[0];
                let pc_b = pcLine.bandwidth[0];
                if (!sdpinterop) {
                    // u plan, set separate limits
                    let pc_target = pc_b.limit - min_video_bps;
                    if (pc_target < min_video_bps) {
                        pc_target = min_video_bps;
                    }
                    video_b.limit = min_video_bps;
                    pc_b.limit = pc_target;
                }
            }
        }
        if (browser_name !== "firefox") {
            // convert to AS attributes
            session.media.forEach(function(mline: any) {
                if (mline.bandwidth && mline.bandwidth.length > 0) {
                    let b = mline.bandwidth[0];
                    if (b.type === "TIAS") {
                        let bASline = { type: "AS", limit: b.limit / 1000 };
                        mline.bandwidth.push(bASline);
                    }
                }
            });
        }
    };

    let mungeRemote = function(data: SdpData) {
        if (data.originator !== "remote") {
            throw "local sdp input into mungeRemote";
        }
        log("recv u plan", deepCopy(data.sdp));
        let session = parseSdp(data.sdp);
        if (data.type === "offer") {
            remoteOfferProtocols = [];
        }
        let num_mlines = session.media.length;
        session.media.forEach(function(mline: any, index: number, media: any) {
            if (data.type === "offer") {
                remoteOfferProtocols.push(mline.protocol);
                if (localOfferProtocols.length > index) {
                    mline.protocol = localOfferProtocols[index];
                }
            } else {
                // fix the answers protocols to match the offers.
                mline.protocol = localOfferProtocols[index];
            }
            if (mline.port != 0) {
                if (index > 0) {
                    // see https://jira.starleaf.com/browse/SW-9818 - even though the RFC for bundles mandates that
                    // an answer accepting a bundle MUST ONLY place ice attributes in the primary stream, browser will
                    // end the call if these attributes are not present
                    if (!mline.icePwd) {
                        mline.icePwd = media[index - 1].icePwd;
                    }
                    if (!mline.iceUfrag) {
                        mline.iceUfrag = media[index - 1].iceUfrag;
                    }
                }
                if (mline.type === "video") {
                    if (allowH264) {
                        hackH264Level(mline);
                    } else {
                        removeH264(mline);
                    }
                    // If we have PC, remove send only before we squash mline into plan B
                    if (sdpinterop && !local_media.video && index === 1 && num_mlines > 2) {
                        if (mline.direction === "sendonly") {
                            delete mline.direction;
                        }
                    }
                }
            } else {
                mline.direction = "inactive";
            }
        });
        mungeBandwidth(session);
        data.sdp = writeSdp(session);
        if (sdpinterop) {
            // parse the stats SSRC from the U plan SDP
            let result = sdpinterop.toPlanB(data);
            data.sdp = result.sdp;
            log("recv plan b ", deepCopy(data.sdp));
        }
    };

    let mungeLocal = function(data: SdpData) {
        if (data.originator !== "local") {
            throw "remote sdp input into mungeLocal";
        }
        let session = parseSdp(data.sdp);
        session.media.forEach(function(mline: { type: MediaType; [key: string]: any }, index: number) {
            if (mline.port == 0) {
                if (mline.rtcpMux) {
                    delete mline.rtcpMux;
                }
                if (mline.direction) {
                    delete mline.direction;
                }
            } else {
                if (candidate.remote) {
                    mline.remoteCandidates = "1 " + candidate.remote.ipAddress + " " + candidate.remote.portNumber;
                }
                if (candidate.local) {
                    mline.connection.ip = candidate.local.ipAddress;
                    mline.port = candidate.local.portNumber;
                }
            }
            if (mline.rtp) {
                // We don't support DTMF with webrtc at the moment, and it's causing issues - see SW-11129
                mline.rtp = mline.rtp.filter((rtp_line: any) => {
                    return !(rtp_line.codec === "telephone-event");
                });
            }
            if (mline.type === "video") {
                if (allowH264) {
                    hackH264Params(mline);
                } else {
                    removeH264(mline);
                }
            }
            if (sdpinterop && !local_media[mline.type] && index < 2) {
                if (mline.ssrcGroups && mline.ssrcGroups.length > 1) {
                    logger.warn("Chrome now has ssrcs for recvonly streams");
                } else {
                    // add some fake ssrcs for the main video.
                    // there may be other ssrcs for the PC.
                    let fake_ssrc_1 = (index * 2 + 1).toString();
                    let fake_ssrc_2 = (index * 2 + 2).toString();
                    if (!mline.sources) {
                        mline.sources = {};
                    }
                    mline.sources[fake_ssrc_1] = { cname: "fake" };
                    mline.sources[fake_ssrc_2] = { cname: "fake" };
                    if (mline.type === "audio") {
                        delete mline.direction;
                    }
                    mline.ssrcGroups = [
                        {
                            semantics: "FID",
                            ssrcs: [fake_ssrc_1, fake_ssrc_2]
                        }
                    ].concat(mline.ssrcGroups ? mline.ssrcGroups : []);
                }
            }
        });
        data.sdp = writeSdp(session);
        if (sdpinterop) {
            // parse the stats SSRC from the U plan SDP
            log("send plan b", deepCopy(data.sdp));
            let result = sdpinterop.toUnifiedPlan(data);
            data.sdp = result.sdp;
        }
        session = parseSdp(data.sdp);

        if (data.type === "offer") {
            localOfferProtocols = [];
        }
        let videoLines = 0;
        session.media.forEach(function(mline: { type: MediaType; [key: string]: any }, index: any) {
            if (data.type === "offer") {
                localOfferProtocols.push(mline.protocol);
                if (tcpMedia) {
                    mline.protocol = "TCP/DTLS/RTP/SAVPF";
                } else {
                    mline.protocol = "UDP/TLS/RTP/SAVPF";
                }
            } else {
                mline.protocol = remoteOfferProtocols[index];
            }
            if (mline.type === "video") {
                if (!mline.invalid) {
                    mline.invalid = [];
                }
                if (videoLines++ === 0) {
                    mline.invalid.push({ value: "content:main" });
                    if (!local_media.video) {
                        mline.direction = "recvonly";
                    }
                } else {
                    if (!mline.direction || mline.direction !== "recvonly") {
                        mline.direction = "sendonly";
                    }
                    mline.invalid.push({ value: "content:slides" });
                }
            }
        });
        data.sdp = writeSdp(session);

        log("send uplan", deepCopy(data.sdp));
    };

    let isAudioOnly = function(sdp: any) {
        let session = parseSdp(sdp);
        let result = false;
        session.media.forEach(function(mline: any, index: number) {
            if (mline.port == 0) {
                if (index === 1) {
                    result = true;
                }
            }
        });
        return result;
    };

    let getPcState = function(data: SdpData) {
        let isLocal = data.originator === "local";
        let state = PCState.DISABLED;
        let session = parseSdp(data.sdp);
        let groups = session.groups;
        if (groups.length > 0) {
            let mids = groups[0].mids;
            session.media.forEach(function(mline: any) {
                if (mline.invalid && mline.invalid.length !== 0) {
                    mline.invalid.forEach(function(invalid: any) {
                        if (invalid.value === "content:slides") {
                            if (mline.port !== 0) {
                                if (isLocal) {
                                    if (mline.direction === "sendonly") {
                                        state = PCState.SEND;
                                    } else {
                                        state = PCState.RECV;
                                    }
                                } else {
                                    if (mline.direction === "recvonly") {
                                        state = PCState.SEND;
                                    } else {
                                        state = PCState.RECV;
                                    }
                                }
                            } else if (data.type === "offer") {
                                let in_bundle = mids.indexOf(mline.mid) !== -1;
                                let bundle_only = mline.invalid.some((obj: any) => {
                                    return obj.value === "bundle-only";
                                });
                                if (in_bundle && bundle_only) {
                                    state = PCState.SEND;
                                }
                            }
                        }
                    });
                }
            });
        }
        return state;
    };

    function processW3C(report: any) {
        // https://w3c.github.io/webrtc-stats/#transportstats-dict*
        logger.debug("attempting to process W3C stats");
        report.forEach(function(obj: any) {
            if (obj.type === "transport" && !check_cands()) {
                let pair = report.get(obj.selectedCandidatePairId);
                let local = report.get(pair.localCandidateId);
                let remote = report.get(pair.remoteCandidateId);
                candidate.local = {
                    ipAddress: local.ip,
                    portNumber: local.port
                };
                candidate.remote = {
                    ipAddress: remote.ip,
                    portNumber: remote.port
                };
                tcpMedia = local.protocol === "tcp";
            }
        });
        return check_cands();
    }

    function processOldChrome(obj: any, getter: any) {
        if (obj.type === "googComponent" || typeof obj.googComponent !== "undefined") {
            if (typeof obj.selectedCandidatePairId !== "undefined") {
                let cand_pair = getter(obj.selectedCandidatePairId);
                if (cand_pair.googTransportType === "tcp") {
                    logger.debug("Using tcp media detected via matching candidate pair id to component");
                    tcpMedia = true;
                }
                let c;
                if (typeof cand_pair.remoteCandidateId !== "undefined") {
                    c = getter(cand_pair.remoteCandidateId);
                    candidate.remote = c;
                }
                if (typeof cand_pair.localCandidateId !== "undefined") {
                    c = getter(cand_pair.localCandidateId);
                    candidate.local = c;
                }
            }
        } else if (obj.type === "googCandidatePair") {
            if (obj.googActiveConnection === "true" || obj.googActiveConnection === true) {
                if (obj.googTransportType && obj.googTransportType === "tcp") {
                    logger.debug("Using tcp media detected via active googCandidatePair");
                    tcpMedia = true;
                }
                if (!check_cands()) {
                    let local = obj.googLocalAddress.split(":");
                    candidate.local = {
                        ipAddress: local[0],
                        portNumber: local[1]
                    };
                    let remote = obj.googRemoteAddress.split(":");
                    candidate.remote = {
                        ipAddress: remote[0],
                        portNumber: remote[1]
                    };
                }
            }
        }
    }

    // TODO neaten up when we can drop support for out of date browsers

    let parseChromiumStats = function(report: any) {
        try {
            if (processW3C(report)) {
                logger.debug("Chrome W3C stats present, parsed candidates");
                return true;
            }
        } catch (ex) {
            logger.warn("non W3C stats, try old chrome stat parsing");
        }
        let getter: any;
        if (typeof report.forEach !== "undefined") {
            logger.debug("map like stats");
            getter = function(key: any) {
                return report.get(key);
            };
            report.forEach(function(value: any) {
                processOldChrome(value, getter);
            });
        } else {
            getter = function(key: any) {
                return report[key];
            };
            Object.keys(report).forEach(function(key) {
                processOldChrome(getter(key), getter);
            });
        }
        return check_cands();
    };

    let parseFirefoxStats = function(report: any, audioOnly: boolean) {
        if (processW3C(report)) {
            logger.debug("Firefox W3C stats present, parsed candidates");
            return true;
        } else {
            logger.warn("non W3C stats, try old firefox stat parsing");
            report.forEach(function(obj: any) {
                if (obj.type === "candidatepair" || obj.type === "candidate-pair") {
                    if (obj.selected === true && obj.state === "succeeded") {
                        let c;
                        c = report.get(obj.remoteCandidateId);
                        candidate.remote = c;
                        if (c["transport"].toLowerCase() === "tcp") {
                            tcpMedia = true;
                        }
                        c = report.get(obj.localCandidateId);
                        candidate.local = c;
                    }
                }
            });
            let ready = report.get("inbound_rtp_audio_0")["ssrc"] !== "0";
            if (!audioOnly) {
                ready = ready && report.get("inbound_rtp_video_1")["ssrc"] !== "0";
            }
            return check_cands() && ready;
        }
    };

    let setStatsTimer = function(pc: RTCPeerConnection, audioOnly: boolean, callback: any) {
        statsTimeout = window.setTimeout(function() {
            onIceComplete(pc, audioOnly, callback);
        }, 500);
    };

    // the callback is necessary as pc.getStats is not blocking.
    // TODO(rdt): remove this logic when entire cloud is > capi 888.
    // Post CAPI 888, the cloud sends the ICE re-invite and fixes up the candidates in the SDP
    // rendering this work unnecessary.
    let onIceComplete = function(pc: RTCPeerConnection, audioOnly: boolean, callback: any) {
        let onChromeStats = function(report: any) {
            logger.debug("Parsing stats for ice re-invite info");
            if (parseChromiumStats(report)) {
                callback();
            } else {
                logger.debug("Stats not present yet, setting timer");
                setStatsTimer(pc, audioOnly, callback);
            }
        };
        if (browser_name !== "firefox") {
            try {
                (pc as any)
                    .getStats()
                    .then(onChromeStats)
                    .catch(function(error: any) {
                        logger.error("Failed to get stats to check tcp media: ", error);
                        callback();
                    });
            } catch (ex) {
                // pc may not be a promise on IE/Safari/Old chrome
                pc.getStats(null, onChromeStats, function() {
                    logger.error("Failed to get stats to check tcp media");
                    callback();
                });
            }
        } else {
            (pc as any).getStats().then(function(stats: any) {
                if (parseFirefoxStats(stats, audioOnly)) {
                    callback();
                } else {
                    setStatsTimer(pc, audioOnly, callback);
                }
            });
        }
    };

    let stop = function() {
        window.clearTimeout(statsTimeout);
    };

    function setLocalMedia(stream?: MediaStream) {
        local_media = sl.hasLocalMedia(stream);
    }

    let that = {
        mungeRemote: mungeRemote,
        mungeLocal: mungeLocal,
        isAudioOnly: isAudioOnly,
        getPcState: getPcState,
        onIceComplete: onIceComplete,
        setLocalMedia: setLocalMedia,
        stop: stop
    };
    return that;
}
