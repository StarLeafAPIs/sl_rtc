"use strict";
/*
* Copyright (c) StarLeaf Limited, 2017
*/
Object.defineProperty(exports, "__esModule", { value: true });
const SdpInterop = require("sdp-interop-sl");
const sl_1 = require("../sl");
const interface_1 = require("./interface");
const sl = require("../sl");
const sprintf_js_1 = require("sprintf-js");
function SdpMunger(base_logger, logSdp, plugin, allowH264) {
    let min_video_bps = 200 * 1000;
    let max_bps_without_bwe = 512 * 1000;
    let bwe_enabled = true;
    let logger = base_logger.sub('SDP');
    let sdpinterop = null;
    let browser_name = sl_1.detectedBrowser;
    // Only firefox and edge don't use plan B SDP.
    if (browser_name !== 'firefox' && browser_name !== 'edge') {
        sdpinterop = SdpInterop.InteropChrome();
    }
    let deepCopy = function (thing) {
        return JSON.parse(JSON.stringify(thing));
    };
    let parseSdp = SdpInterop.transform.parse;
    let writeSdp = SdpInterop.transform.write;
    let local_media = {
        audio: false,
        video: false
    };
    // mline protocol must always match the offer.
    let localOfferProtocols = [];
    let remoteOfferProtocols = [];
    // plugin may remap this after initially specifying it. We will reverse this.
    let video_abs_send_ext_number = null;
    let tcpMedia = false;
    // we will parse this from the peer connection stats, and add them to the SDP.
    let candidate = {
        local: null,
        remote: null
    };
    let statsTimeout = -1;
    let check_cands = function () {
        return candidate.local !== null && candidate.remote !== null;
    };
    let log;
    if (logSdp) {
        log = function (...args) {
            logger.debug(...args);
        };
    }
    else {
        log = function () { };
    }
    let checkContent = function (invalids, contentType) {
        if (typeof invalids !== 'undefined') {
            for (let i = 0; i < invalids.length; i++) {
                if (invalids[i].value === 'content:' + contentType) {
                    return true;
                }
            }
        }
        return false;
    };
    // StarLeaf sends H.264 baseline profile - however our baseline obeys all the limitations of the
    // Constrained Baseline profile, so hack the required bit into the profile-level-id when receiving
    // SDP from StarLeaf
    let hackH264Level = function (mline) {
        if (mline.rtp) {
            mline.rtp.forEach(function (rtp) {
                if (rtp.codec === 'H264' && mline.fmtp) {
                    for (let k = 0; k < mline.fmtp.length; k++) {
                        let fmtp = mline.fmtp[k];
                        if (fmtp.payload === rtp.payload) {
                            let params = fmtp.config.split(';');
                            for (let i = 0; i < params.length; i++) {
                                if (params[i].startsWith('profile-level-id')) {
                                    let profile = parseInt(params[i].split('=')[1].substr(0, 6), 16);
                                    if (profile & 0x420000) {
                                        profile |= 0x004000;
                                        log('hacked h264 profile level');
                                    }
                                    else {
                                        throw 'H.264 profile is not baseline';
                                    }
                                    params[i] = 'profile-level-id=' + profile.toString(16);
                                }
                            }
                            fmtp.config = params.join(';');
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
        { key: 'max-fs', value: 8192 },
        { key: 'max-mbps', value: 245000 },
        { key: 'max-dpb', value: 32768 }
    ];
    let hackH264Params = function (mline) {
        if (mline.rtp) {
            mline.rtp.forEach(function (rtp) {
                if (rtp.codec === 'H264' && mline.fmtp) {
                    for (let k = 0; k < mline.fmtp.length; k++) {
                        let fmtp = mline.fmtp[k];
                        if (fmtp.payload === rtp.payload) {
                            let params = fmtp.config.split(';').map(function (param) {
                                let split = param.split('=');
                                return { key: split[0], value: split[1] };
                            });
                            h264Params.forEach(function (p) {
                                for (let i = 0; i < params.length; i++) {
                                    if (params[i].key === p.key) {
                                        params[i].value = p.value;
                                        return;
                                    }
                                }
                                params.push(p);
                            });
                            fmtp.config = params
                                .map(function (p) {
                                return p.key + '=' + p.value;
                            })
                                .join(';');
                            log('hacked h264 fmtp ', fmtp);
                        }
                    }
                }
            });
        }
    };
    let removeH264 = function (mline) {
        log('removing h264 from mline');
        let new_rtp = [];
        let new_fmtp = [];
        let new_rtcpFb = [];
        let h264_payloads = [];
        if (mline.rtp) {
            mline.rtp.forEach(function (rtp) {
                if (rtp.codec !== 'H264') {
                    new_rtp.push(rtp);
                }
                else {
                    h264_payloads.push(rtp.payload);
                }
            });
        }
        if (mline.fmtp) {
            mline.fmtp.forEach(function (fmtp) {
                if (h264_payloads.indexOf(fmtp.payload) === -1) {
                    new_fmtp.push(fmtp);
                }
            });
        }
        if (mline.rtcpFb) {
            mline.rtcpFb.forEach(function (rtcpFb) {
                if (h264_payloads.indexOf(rtcpFb.payload) === -1) {
                    new_rtcpFb.push(rtcpFb);
                }
            });
        }
        mline.rtp = new_rtp;
        mline.fmtp = new_fmtp;
        mline.rtcpFb = new_rtcpFb;
        if (mline.payloads && typeof mline.payloads === 'string') {
            let payloads = [];
            mline.payloads.split(' ').forEach(function (pt) {
                if (h264_payloads.indexOf(String(pt)) === -1) {
                    payloads.push(pt);
                }
            });
            mline.payloads = payloads.join(' ');
        }
    };
    let mungeBandwidth = function (session) {
        let videoLine = null;
        let pcLine = null;
        session.media.forEach(function (line) {
            if (line.type === 'video' && typeof line.invalid !== 'undefined') {
                if (checkContent(line.invalid, 'main')) {
                    videoLine = line;
                }
                else if (line.direction === 'recvonly' && checkContent(line.invalid, 'slides')) {
                    pcLine = line;
                }
                if (line.rtcpFb && line.bandwidth) {
                    bwe_enabled = line.rtcpFb.some(function (fb) {
                        return fb.type === 'goog-remb';
                    });
                    if (!bwe_enabled) {
                        logger.info(sprintf_js_1.sprintf('bwe disabled, hard capping send bandwidth to %d kbps', max_bps_without_bwe / 1000));
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
        if (browser_name !== 'firefox') {
            // convert to AS attributes
            session.media.forEach(function (mline) {
                if (mline.bandwidth && mline.bandwidth.length > 0) {
                    let b = mline.bandwidth[0];
                    if (b.type === 'TIAS') {
                        let bASline = { type: 'AS', limit: b.limit / 1000 };
                        mline.bandwidth.push(bASline);
                    }
                }
            });
        }
    };
    let mungeRemote = function (data) {
        if (data.originator !== 'remote') {
            throw 'local sdp input into mungeRemote';
        }
        log('recv u plan', deepCopy(data.sdp));
        let session = parseSdp(data.sdp);
        if (data.type === 'offer') {
            remoteOfferProtocols = [];
        }
        let num_mlines = session.media.length;
        session.media.forEach(function (mline, index, media) {
            if (mline.type === 'audio') {
                if (plugin) {
                    // Use separate msids when talking to the plugin to prevent a crash on renegotiation.
                    mline.msid = 'sl-audio-stream sl-audio';
                }
            }
            if (data.type === 'offer') {
                remoteOfferProtocols.push(mline.protocol);
                if (localOfferProtocols.length > index) {
                    mline.protocol = localOfferProtocols[index];
                }
            }
            else {
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
                if (mline.type === 'video') {
                    if (allowH264) {
                        hackH264Level(mline);
                    }
                    else {
                        removeH264(mline);
                    }
                    // If we have PC, remove send only before we squash mline into plan B
                    if (sdpinterop && !local_media.video && index === 1 && num_mlines > 2) {
                        if (mline.direction === 'sendonly') {
                            delete mline.direction;
                        }
                    }
                }
            }
            else {
                mline.direction = 'inactive';
            }
        });
        mungeBandwidth(session);
        data.sdp = writeSdp(session);
        if (sdpinterop) {
            // parse the stats SSRC from the U plan SDP
            let result = sdpinterop.toPlanB(data);
            data.sdp = result.sdp;
            log('recv plan b ', deepCopy(data.sdp));
        }
    };
    let mungeLocal = function (data) {
        if (data.originator !== 'local') {
            throw 'remote sdp input into mungeLocal';
        }
        let session = parseSdp(data.sdp);
        session.media.forEach(function (mline, index) {
            if (mline.port == 0) {
                if (mline.rtcpMux) {
                    delete mline.rtcpMux;
                }
                if (mline.direction) {
                    delete mline.direction;
                }
            }
            else {
                if (candidate.remote) {
                    mline.remoteCandidates =
                        '1 ' + candidate.remote.ipAddress + ' ' + candidate.remote.portNumber;
                }
                if (candidate.local) {
                    mline.connection.ip = candidate.local.ipAddress;
                    mline.port = candidate.local.portNumber;
                }
            }
            if (mline.rtp) {
                // We don't support DTMF with webrtc at the moment, and it's causing issues - see SW-11129
                mline.rtp = mline.rtp.filter((rtp_line) => {
                    return !(rtp_line.codec === 'telephone-event');
                });
            }
            if (mline.type === 'video') {
                if (plugin && mline.ext) {
                    for (let ext_index = 0; ext_index < mline.ext.length; ext_index++) {
                        let rtp_ext = mline.ext[ext_index];
                        if (rtp_ext.uri ===
                            'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time') {
                            if (!video_abs_send_ext_number) {
                                video_abs_send_ext_number = rtp_ext.value;
                            }
                            else {
                                if (rtp_ext.value != video_abs_send_ext_number) {
                                    logger.warn(sprintf_js_1.sprintf('absolute send time extension number changed ' +
                                        'from %d to %d, hacking back to %d', video_abs_send_ext_number, rtp_ext.value, video_abs_send_ext_number));
                                }
                                rtp_ext.value = video_abs_send_ext_number;
                            }
                            break;
                        }
                    }
                }
                if (allowH264) {
                    hackH264Params(mline);
                }
                else {
                    removeH264(mline);
                }
            }
            if (sdpinterop && !local_media[mline.type] && index < 2) {
                if (mline.ssrcGroups && mline.ssrcGroups.length > 1) {
                    logger.warn('Chrome now has ssrcs for recvonly streams');
                }
                else {
                    // add some fake ssrcs for the main video.
                    // there may be other ssrcs for the PC.
                    let fake_ssrc_1 = (index * 2 + 1).toString();
                    let fake_ssrc_2 = (index * 2 + 2).toString();
                    if (!mline.sources) {
                        mline.sources = {};
                    }
                    mline.sources[fake_ssrc_1] = { cname: 'fake' };
                    mline.sources[fake_ssrc_2] = { cname: 'fake' };
                    if (mline.type === 'audio') {
                        delete mline.direction;
                    }
                    mline.ssrcGroups = [
                        {
                            semantics: 'FID',
                            ssrcs: [fake_ssrc_1, fake_ssrc_2]
                        }
                    ].concat(mline.ssrcGroups ? mline.ssrcGroups : []);
                }
            }
        });
        data.sdp = writeSdp(session);
        if (sdpinterop) {
            // parse the stats SSRC from the U plan SDP
            log('send plan b', deepCopy(data.sdp));
            let result = sdpinterop.toUnifiedPlan(data);
            data.sdp = result.sdp;
        }
        session = parseSdp(data.sdp);
        if (data.type === 'offer') {
            localOfferProtocols = [];
        }
        let videoLines = 0;
        session.media.forEach(function (mline, index) {
            if (data.type === 'offer') {
                localOfferProtocols.push(mline.protocol);
                if (tcpMedia) {
                    mline.protocol = 'TCP/DTLS/RTP/SAVPF';
                }
                else {
                    mline.protocol = 'UDP/TLS/RTP/SAVPF';
                }
            }
            else {
                mline.protocol = remoteOfferProtocols[index];
            }
            if (mline.type === 'video') {
                if (!mline.invalid) {
                    mline.invalid = [];
                }
                if (videoLines++ === 0) {
                    mline.invalid.push({ value: 'content:main' });
                    if (!local_media.video) {
                        mline.direction = 'recvonly';
                    }
                }
                else {
                    if (!mline.direction || mline.direction !== 'recvonly') {
                        mline.direction = 'sendonly';
                    }
                    mline.invalid.push({ value: 'content:slides' });
                }
            }
        });
        data.sdp = writeSdp(session);
        log('send uplan', deepCopy(data.sdp));
    };
    let isAudioOnly = function (sdp) {
        let session = parseSdp(sdp);
        let result = false;
        session.media.forEach(function (mline, index) {
            if (mline.port == 0) {
                if (index === 1) {
                    result = true;
                }
            }
        });
        return result;
    };
    let getPcState = function (data) {
        let isLocal = data.originator === 'local';
        let state = interface_1.PCState.DISABLED;
        let session = parseSdp(data.sdp);
        let groups = session.groups;
        if (groups.length > 0) {
            let mids = groups[0].mids;
            session.media.forEach(function (mline) {
                if (mline.invalid && mline.invalid.length !== 0) {
                    mline.invalid.forEach(function (invalid) {
                        if (invalid.value === 'content:slides') {
                            if (mline.port !== 0) {
                                if (isLocal) {
                                    if (mline.direction === 'sendonly') {
                                        state = interface_1.PCState.SEND;
                                    }
                                    else {
                                        state = interface_1.PCState.RECV;
                                    }
                                }
                                else {
                                    if (mline.direction === 'recvonly') {
                                        state = interface_1.PCState.SEND;
                                    }
                                    else {
                                        state = interface_1.PCState.RECV;
                                    }
                                }
                            }
                            else if (data.type === 'offer') {
                                let in_bundle = mids.indexOf(mline.mid) !== -1;
                                let bundle_only = mline.invalid.some((obj) => {
                                    return obj.value === 'bundle-only';
                                });
                                if (in_bundle && bundle_only) {
                                    state = interface_1.PCState.SEND;
                                }
                            }
                        }
                    });
                }
            });
        }
        return state;
    };
    let restartPC = function (data, peer_con, callback, error) {
        logger.debug('Faking restart of PC stream');
        let tempData = {
            originator: data.originator,
            type: data.type,
            sdp: deepCopy(data.sdp)
        };
        let session = parseSdp(tempData.sdp);
        session.media[2].port = 0;
        tempData.sdp = writeSdp(session);
        mungeRemote(tempData);
        peer_con.setRemoteDescription(tempData, callback, error);
    };
    function processW3C(report) {
        // https://w3c.github.io/webrtc-stats/#transportstats-dict*
        logger.debug('attempting to process W3C stats');
        report.forEach(function (obj) {
            if (obj.type === 'transport' && !check_cands()) {
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
                tcpMedia = local.protocol === 'tcp';
            }
        });
        return check_cands();
    }
    function processOldChrome(obj, getter) {
        if (obj.type === 'googComponent' || typeof obj.googComponent !== 'undefined') {
            if (typeof obj.selectedCandidatePairId !== 'undefined') {
                let cand_pair = getter(obj.selectedCandidatePairId);
                if (cand_pair.googTransportType === 'tcp') {
                    logger.debug('Using tcp media detected via matching candidate pair id to component');
                    tcpMedia = true;
                }
                let c;
                if (typeof cand_pair.remoteCandidateId !== 'undefined') {
                    c = getter(cand_pair.remoteCandidateId);
                    candidate.remote = c;
                }
                if (typeof cand_pair.localCandidateId !== 'undefined') {
                    c = getter(cand_pair.localCandidateId);
                    candidate.local = c;
                }
            }
        }
        else if (obj.type === 'googCandidatePair') {
            if (obj.googActiveConnection === 'true' || obj.googActiveConnection === true) {
                if (obj.googTransportType && obj.googTransportType === 'tcp') {
                    logger.debug('Using tcp media detected via active googCandidatePair');
                    tcpMedia = true;
                }
                if (!check_cands()) {
                    let local = obj.googLocalAddress.split(':');
                    candidate.local = {
                        ipAddress: local[0],
                        portNumber: local[1]
                    };
                    let remote = obj.googRemoteAddress.split(':');
                    candidate.remote = {
                        ipAddress: remote[0],
                        portNumber: remote[1]
                    };
                }
            }
        }
    }
    // TODO neaten up when we can drop support for out of date browsers
    let parseChromiumStats = function (report) {
        try {
            if (processW3C(report)) {
                logger.debug('Chrome W3C stats present, parsed candidates');
                return true;
            }
        }
        catch (ex) {
            logger.warn('non W3C stats, try old chrome and old plugin stat parsing');
        }
        let getter;
        if (typeof report.forEach !== 'undefined') {
            logger.debug('map like stats');
            getter = function (key) {
                return report.get(key);
            };
            report.forEach(function (value) {
                processOldChrome(value, getter);
            });
        }
        else {
            getter = function (key) {
                return report[key];
            };
            Object.keys(report).forEach(function (key) {
                processOldChrome(getter(key), getter);
            });
        }
        return check_cands();
    };
    let parseFirefoxStats = function (report, audioOnly) {
        if (processW3C(report)) {
            logger.debug('Firefox W3C stats present, parsed candidates');
            return true;
        }
        else {
            logger.warn('non W3C stats, try old firefox stat parsing');
            report.forEach(function (obj) {
                if (obj.type === 'candidatepair' || obj.type === 'candidate-pair') {
                    if (obj.selected === true && obj.state === 'succeeded') {
                        let c;
                        c = report.get(obj.remoteCandidateId);
                        candidate.remote = c;
                        if (c['transport'].toLowerCase() === 'tcp') {
                            tcpMedia = true;
                        }
                        c = report.get(obj.localCandidateId);
                        candidate.local = c;
                    }
                }
            });
            let ready = report.get('inbound_rtp_audio_0')['ssrc'] !== '0';
            if (!audioOnly) {
                ready = ready && report.get('inbound_rtp_video_1')['ssrc'] !== '0';
            }
            return check_cands() && ready;
        }
    };
    let setStatsTimer = function (pc, audioOnly, callback) {
        statsTimeout = window.setTimeout(function () {
            onIceComplete(pc, audioOnly, callback);
        }, 500);
    };
    // the callback is necessary as pc.getStats is not blocking.
    let onIceComplete = function (pc, audioOnly, callback) {
        let onChromeStats = function (report) {
            logger.debug('Parsing stats for ice re-invite info');
            if (parseChromiumStats(report)) {
                callback();
            }
            else {
                logger.debug('Stats not present yet, setting timer');
                setStatsTimer(pc, audioOnly, callback);
            }
        };
        if (browser_name !== 'firefox') {
            try {
                pc
                    .getStats()
                    .then(onChromeStats)
                    .catch(function (error) {
                    logger.error('Failed to get stats to check tcp media: ', error);
                    callback();
                });
            }
            catch (ex) {
                // pc may not be a promise on IE/Safari/Old chrome
                pc.getStats(null, onChromeStats, function () {
                    logger.error('Failed to get stats to check tcp media');
                    callback();
                });
            }
        }
        else {
            pc.getStats().then(function (stats) {
                if (parseFirefoxStats(stats, audioOnly)) {
                    callback();
                }
                else {
                    setStatsTimer(pc, audioOnly, callback);
                }
            });
        }
    };
    let stop = function () {
        window.clearTimeout(statsTimeout);
    };
    function setLocalMedia(stream) {
        local_media = sl.hasLocalMedia(stream);
    }
    let that = {
        mungeRemote: mungeRemote,
        mungeLocal: mungeLocal,
        isAudioOnly: isAudioOnly,
        getPcState: getPcState,
        restartPC: restartPC,
        onIceComplete: onIceComplete,
        setLocalMedia: setLocalMedia,
        stop: stop
    };
    return that;
}
exports.SdpMunger = SdpMunger;
