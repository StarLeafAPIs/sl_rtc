"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SdpInterop = require("sdp-interop-sl");
const sprintf_js_1 = require("sprintf-js");
function StatsManager(period, logger) {
    let period_seconds = period / 1000.0;
    let stats_timer = -1;
    let ssrcs = {};
    let onStats = function (data) {
        try {
            processStats(data);
        }
        catch (ex) {
            logger.error("Failed to parse WebRTC standard stats");
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
    let commonSendStats = function (result, ssrc_info, raw_stats) {
        result.pktrate = (+raw_stats.packetsSent - ssrc_info.pkts) / period_seconds;
        result.kbps = ((+raw_stats.bytesSent - ssrc_info.bytes) * 8.0) / (period_seconds * 1000.0);
        if (typeof raw_stats.pliCount !== "undefined") {
            // for video at least we can count the PLI's
            result.pliCount = +raw_stats.pliCount - ssrc_info.pliCount;
            ssrc_info.pliCount = +raw_stats.pliCount;
        }
        if (typeof raw_stats.roundTripTime !== "undefined") {
            result.rtt = +raw_stats.roundTripTime;
        }
        ssrc_info.pkts = +raw_stats.packetsSent;
        ssrc_info.bytes = +raw_stats.bytesSent;
    };
    let commonRecvStats = function (result, ssrcInfo, rawStats) {
        result.pktrate = (+rawStats.packetsReceived - ssrcInfo.pkts) / period_seconds;
        result.kbps = ((+rawStats.bytesReceived - ssrcInfo.bytes) * 8.0) / (period_seconds * 1000.0);
        result.lost = +rawStats.packetsLost - ssrcInfo.lost;
        ssrcInfo.pkts = +rawStats.packetsReceived;
        ssrcInfo.bytes = +rawStats.bytesReceived;
        ssrcInfo.lost = +rawStats.packetsLost;
    };
    let processStats = function (report) {
        let results = [];
        Object.keys(ssrcs).forEach(function (ssrc) {
            let ssrcInfo = ssrcs[ssrc];
            let type = ssrcInfo.direction === "in" ? "inbound-rtp" : "outbound-rtp";
            report.forEach(function (obj) {
                if (obj.type === type && +obj.ssrc === +ssrc) {
                    let parsedStat = {
                        media: ssrcInfo.media,
                        direction: ssrcInfo.direction
                    };
                    if (ssrcInfo.direction === "in") {
                        commonRecvStats(parsedStat, ssrcInfo, obj);
                    }
                    else {
                        commonSendStats(parsedStat, ssrcInfo, obj);
                    }
                    results.push(parsedStat);
                }
            });
        });
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
                peerConnection
                    .getStats(null)
                    .then(onStats)
                    .catch(onFailure);
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
        let direction = data.originator === "remote" ? "in" : "out";
        session.media.forEach(function (mline, index) {
            if (mline.sources && Object.keys(mline.sources).length === 1) {
                let ssrc = Object.keys(mline.sources)[0];
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
                logger.warn("Unusual mline in SDP, cannot parse single ssrc ");
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
