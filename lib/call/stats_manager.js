"use strict";
/*
* Copyright (c) StarLeaf Limited, 2017
*/
Object.defineProperty(exports, "__esModule", { value: true });
const sl = require("../sl");
const SdpInterop = require("sdp-interop-sl");
const sprintf_js_1 = require("sprintf-js");
function StatsManager(period, logger) {
    let period_seconds = period / 1000.0;
    let stats_timer = -1;
    let ssrcs = {};
    let onStats = function (data) {
        let parsed_w3c = false;
        try {
            parsed_w3c = processW3C(data);
        }
        catch (ex) {
            // If parsing the standard defined stats fails, use the older browser specific parse functions
        }
        if (!parsed_w3c) {
            if (sl.detectedBrowser === "firefox") {
                processFirefox(data);
            }
            else {
                processChrome(data);
            }
        }
    };
    let onFailure = function (reason) {
        logger.error("Failed to get stats because: ", reason);
    };
    function isDefined(thing) {
        return typeof thing !== "undefined";
    }
    let logResults = function (results) {
        for (let i = 0; i < results.length; i++) {
            let stat = results[i];
            let logline = sprintf_js_1.sprintf("%s-%s:", stat.media, stat.direction);
            logline += " pkts/s=" + (isDefined(stat.pktrate) ? sprintf_js_1.sprintf("%d", stat.pktrate) : "unknown");
            logline += " kbps=" + (isDefined(stat.kbps) ? sprintf_js_1.sprintf("%d", stat.kbps) : "unknown");
            if (isDefined(stat.lost)) {
                logline += " lost=" + stat.lost;
            }
            if (isDefined(stat.pliCount)) {
                logline += " plis=" + stat.pliCount;
            }
            logline += isDefined(stat.rtt) ? sprintf_js_1.sprintf(" rtt=%d", stat.rtt) : "";
            logger.debug(logline);
        }
    };
    // for reference, a plus sign is an implicit conversion to the number type.
    let commonSendStats = function (result, ssrcInfo, rawStats) {
        result.pktrate = (+rawStats.packetsSent - ssrcInfo.pkts) / period_seconds;
        result.kbps = (+rawStats.bytesSent - ssrcInfo.bytes) * 8.0 / (period_seconds * 1000.0);
        if (typeof rawStats.pliCount !== 'undefined') {
            // for video at least we can count the PLI's
            result.pliCount = +rawStats.pliCount - ssrcInfo.pliCount;
            ssrcInfo.pliCount = +rawStats.pliCount;
        }
        if (typeof rawStats.roundTripTime !== 'undefined') {
            result.rtt = +rawStats.roundTripTime;
        }
        ssrcInfo.pkts = +rawStats.packetsSent;
        ssrcInfo.bytes = +rawStats.bytesSent;
    };
    let commonRecvStats = function (result, ssrcInfo, rawStats) {
        result.pktrate = (+rawStats.packetsReceived - ssrcInfo.pkts) / period_seconds;
        result.kbps = ((+rawStats.bytesReceived - ssrcInfo.bytes) * 8.0) / (period_seconds * 1000.0);
        result.lost = +rawStats.packetsLost - ssrcInfo.lost;
        ssrcInfo.pkts = +rawStats.packetsReceived;
        ssrcInfo.bytes = +rawStats.bytesReceived;
        ssrcInfo.lost = +rawStats.packetsLost;
    };
    let processChrome = function (report) {
        function process(stats, ssrc_info) {
            let parsed_stat = {};
            parsed_stat.media = ssrc_info.media;
            parsed_stat.direction = ssrc_info.direction;
            if (typeof stats.bytesSent !== "undefined") {
                if (typeof stats.audioInputLevel !== "undefined") {
                    commonSendStats(parsed_stat, ssrc_info, stats);
                }
                else {
                    commonSendStats(parsed_stat, ssrc_info, stats);
                }
            }
            else {
                if (typeof stats.audioOutputLevel !== "undefined") {
                    commonRecvStats(parsed_stat, ssrc_info, stats);
                }
                else {
                    commonRecvStats(parsed_stat, ssrc_info, stats);
                }
            }
            results.push(parsed_stat);
        }
        function parseKey(key) {
            return key
                .replace("ssrc_", "")
                .replace("_recv", "")
                .replace("_send", "");
        }
        let results = [];
        if (typeof report.forEach !== "undefined") {
            report.forEach(function (value, key) {
                if (value.type === "ssrc") {
                    let parsed_key = parseKey(key);
                    if (typeof ssrcs[parsed_key] !== "undefined") {
                        process(value, ssrcs[parsed_key]);
                    }
                }
            });
        }
        else {
            Object.keys(report).forEach(function (key) {
                if (report[key].type === "ssrc") {
                    let parsedKey = parseKey(key);
                    if (typeof ssrcs[parsedKey] !== "undefined") {
                        process(report[key], ssrcs[parsedKey]);
                    }
                }
            });
        }
        logResults(results);
    };
    let findStat = function (report, ssrc, direction, rtcp) {
        let test = direction === "in";
        if (rtcp) {
            test = !test;
        } // firefox labels the rtcp it produces for the outbound rtp as 'inboundrtp' for some reason
        let old_type = test ? "inboundrtp" : "outboundrtp";
        // WebRTC spec says these stats should have dashes
        let new_type = test ? "inbound-rtp" : "outbound-rtp";
        let result = null;
        report.forEach((stat) => {
            if (typeof stat.ssrc !== "undefined" && typeof stat.type !== "undefined") {
                if (stat.ssrc === ssrc && (stat.type === old_type || stat.type === new_type)) {
                    result = stat;
                }
            }
        });
        return result;
    };
    let processFirefox = (report) => {
        let results = [];
        Object.keys(ssrcs).forEach(function (ssrc) {
            let ssrcInfo = ssrcs[ssrc];
            let rtpStat = findStat(report, ssrc, ssrcInfo.direction, false);
            let rtcpStat = findStat(report, ssrc, ssrcInfo.direction, true);
            if (rtpStat && rtcpStat) {
                let parsedStat = {};
                parsedStat.media = ssrcInfo.media;
                parsedStat.direction = ssrcInfo.direction;
                if (ssrcInfo.direction === "in") {
                    commonRecvStats(parsedStat, ssrcInfo, rtpStat);
                }
                else {
                    rtpStat.packetsLost = rtcpStat.packetsLost;
                    rtpStat.roundTripTime = rtcpStat.mozRtt;
                    commonSendStats(parsedStat, ssrcInfo, rtpStat);
                }
                results.push(parsedStat);
            }
        });
        logResults(results);
    };
    let processSingleStatsEntry = function (report, local, isInbound) {
        let ssrcInfo = ssrcs[local.ssrc];
        let parsedStat = {
            media: ssrcInfo.media,
            direction: ssrcInfo.direction,
        };
        if (isInbound) {
            commonRecvStats(parsedStat, ssrcInfo, local);
        }
        else {
            commonSendStats(parsedStat, ssrcInfo, local);
        }
        return parsedStat;
    };
    let processW3C = function (report) {
        // see https://w3c.github.io/webrtc-stats/#rtcstatstype-str* for the enum
        let results = [];
        for (const stat of report.values()) {
            if (stat.isRemote) {
                continue;
            }
            let isInbound = null;
            if (stat.type === 'inbound-rtp') {
                isInbound = true;
            }
            else if (stat.type === 'outbound-rtp') {
                isInbound = false;
            }
            if (isInbound != null) {
                results.push(processSingleStatsEntry(report, stat, isInbound));
            }
        }
        ;
        if (results.length > 0) {
            logResults(results);
            return true;
        }
        return false;
    };
    let start = function (peerConnection) {
        if (stats_timer === -1) {
            logger.debug("Starting stats timer");
            stats_timer = window.setInterval(function () {
                try {
                    peerConnection
                        .getStats(null)
                        .then(onStats)
                        .catch(onFailure);
                }
                catch (ex) {
                    // Temasys plugin doesn't support promise based peerConnection.getStats()
                    peerConnection.getStats(null, onStats, onFailure);
                }
            }, period);
        }
    };
    let stop = function () {
        if (stats_timer !== -1) {
            logger.debug("Stopping stats timer");
            window.clearInterval(stats_timer);
            stats_timer = -1;
            ssrcs = {};
        }
    };
    let processSdp = function (data) {
        let session = SdpInterop.transform.parse(data.sdp);
        let numVideo = 0;
        // we will keep track of which mline each ssrc is from, so that if it is disabled
        // we can remove it from the list
        let findSsrc = function (mline) {
            let ssrc = null;
            let ssrcs = Object.keys(mline.sources);
            if (ssrcs.length === 1) {
                ssrc = ssrcs[0];
            }
            else if (mline.ssrcGroups && mline.ssrcGroups[0].semantics == 'FID') {
                // per RFC-4588 multiple ssrcs may be sent to indicate retransmission sources - we ignore these
                ssrc = mline.ssrcGroups[0].ssrcs[0];
            }
            return ssrc;
        };
        let direction = data.originator === "remote" ? "in" : "out";
        session.media.forEach(function (mline, index) {
            if (mline.sources && findSsrc(mline)) {
                let ssrc = findSsrc(mline);
                let ssrcEntry = {
                    pkts: 0,
                    bytes: 0,
                    lost: 0,
                    pliCount: 0,
                    index: index,
                    direction: direction,
                    media: mline.type
                };
                if (mline.type === "video") {
                    numVideo++;
                }
                if (ssrcEntry.media === "video" && numVideo > 1) {
                    ssrcEntry.media = "pc"; //dig out the PC entries.
                }
                if (typeof ssrcs[ssrc] === "undefined") {
                    ssrcs[ssrc] = ssrcEntry;
                }
            }
            else if (mline.port === 0) {
                let purged = {};
                Object.keys(ssrcs).forEach(function (ssrc) {
                    let ssrcInfo = ssrcs[ssrc];
                    if (ssrcInfo.index !== index) {
                        purged[ssrc] = ssrcInfo;
                    }
                });
                ssrcs = purged;
            }
            else {
                logger.warn('Unusual mline in SDP for mid=', mline.mid, ', cannot parse single ssrc and no ssrc-group to assist');
            }
        });
    };
    let that = {
        start: start,
        stop: stop,
        processSdp: processSdp
    };
    return that;
}
exports.StatsManager = StatsManager;
