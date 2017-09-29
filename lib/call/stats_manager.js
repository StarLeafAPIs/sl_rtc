"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var sl = require("../sl");
var SdpInterop = require("sdp-interop-sl");
var sprintf_1 = require("sprintf");
function StatsManager(period, logger) {
    var period_seconds = period / 1000.0;
    var stats_timer = -1;
    var ssrcs = {};
    var onStats = function (data) {
        var parsed_w3c = false;
        try {
            parsed_w3c = processW3C(data);
        }
        catch (ex) {
            // If parsing the standard defined stats fails, use the older browser specific parse functions
        }
        if (!parsed_w3c) {
            if (sl.detectedBrowser === 'firefox') {
                processFirefox(data);
            }
            else {
                processChrome(data);
            }
        }
    };
    var onFailure = function (reason) {
        logger.error('Failed to get stats because: ', reason);
    };
    function isDefined(thing) {
        return typeof thing !== 'undefined';
    }
    var logResults = function (results) {
        for (var i = 0; i < results.length; i++) {
            var stat = results[i];
            var logline = sprintf_1.sprintf('%s-%s:', stat.media, stat.direction);
            logline +=
                ' pkts/s=' + (isDefined(stat.pktrate) ? sprintf_1.sprintf('%d', stat.pktrate) : 'unknown');
            logline += ' kbps=' + (isDefined(stat.kbps) ? sprintf_1.sprintf('%d', stat.kbps) : 'unknown');
            if (isDefined(stat.lost)) {
                logline += ' lost=' + stat.lost;
            }
            if (isDefined(stat.pliCount)) {
                logline += ' plis=' + stat.pliCount;
            }
            logline += isDefined(stat.rtt) ? sprintf_1.sprintf(' rtt=%d', stat.rtt) : '';
            logger.debug(logline);
        }
    };
    // for reference, a plus sign is an implicit conversion to the number type.
    var commonSendStats = function (result, ssrc_info, raw_stats) {
        result.pktrate = (+raw_stats.packetsSent - ssrc_info.pkts) / period_seconds;
        result.kbps = (+raw_stats.bytesSent - ssrc_info.bytes) * 8.0 / (period_seconds * 1000.0);
        if (typeof raw_stats.pliCount !== 'undefined') {
            // for video at least we can count the PLI's
            result.pliCount = +raw_stats.pliCount - ssrc_info.pliCount;
            ssrc_info.pliCount = +raw_stats.pliCount;
        }
        if (typeof raw_stats.googRtt !== 'undefined') {
            result.rtt = +raw_stats.googRtt;
        }
        else if (typeof raw_stats.roundTripTime !== 'undefined') {
            result.rtt = +raw_stats.roundTripTime;
        }
        ssrc_info.pkts = +raw_stats.packetsSent;
        ssrc_info.bytes = +raw_stats.bytesSent;
    };
    var commonRecvStats = function (result, ssrcInfo, rawStats) {
        result.pktrate = (+rawStats.packetsReceived - ssrcInfo.pkts) / period_seconds;
        result.kbps = (+rawStats.bytesReceived - ssrcInfo.bytes) * 8.0 / (period_seconds * 1000.0);
        result.lost = +rawStats.packetsLost - ssrcInfo.lost;
        ssrcInfo.pkts = +rawStats.packetsReceived;
        ssrcInfo.bytes = +rawStats.bytesReceived;
        ssrcInfo.lost = +rawStats.packetsLost;
    };
    var processChrome = function (report) {
        function process(stats, ssrc_info) {
            var parsed_stat = {};
            parsed_stat.media = ssrc_info.media;
            parsed_stat.direction = ssrc_info.direction;
            if (typeof stats.bytesSent !== 'undefined') {
                if (typeof stats.audioInputLevel !== 'undefined') {
                    commonSendStats(parsed_stat, ssrc_info, stats);
                }
                else {
                    commonSendStats(parsed_stat, ssrc_info, stats);
                }
            }
            else {
                if (typeof stats.audioOutputLevel !== 'undefined') {
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
                .replace('ssrc_', '')
                .replace('_recv', '')
                .replace('_send', '');
        }
        var results = [];
        if (typeof report.forEach !== 'undefined') {
            report.forEach(function (value, key) {
                if (value.type === 'ssrc') {
                    var parsed_key = parseKey(key);
                    if (typeof ssrcs[parsed_key] !== 'undefined') {
                        process(value, ssrcs[parsed_key]);
                    }
                }
            });
        }
        else {
            Object.keys(report).forEach(function (key) {
                if (report[key].type === 'ssrc') {
                    var parsedKey = parseKey(key);
                    if (typeof ssrcs[parsedKey] !== 'undefined') {
                        process(report[key], ssrcs[parsedKey]);
                    }
                }
            });
        }
        logResults(results);
    };
    var findStat = function (report, ssrc, direction, rtcp) {
        var test = direction === 'in';
        if (rtcp) {
            test = !test;
        } // firefox labels the rtcp it produces for the outbound rtp as 'inboundrtp' for some reason
        var old_type = test ? 'inboundrtp' : 'outboundrtp';
        // WebRTC spec says these stats should have dashes
        var new_type = test ? 'inbound-rtp' : 'outbound-rtp';
        var result = null;
        report.forEach(function (stat) {
            if (typeof stat.ssrc !== 'undefined' && typeof stat.type !== 'undefined') {
                if (stat.ssrc === ssrc && (stat.type === old_type || stat.type === new_type)) {
                    result = stat;
                }
            }
        });
        return result;
    };
    var processFirefox = function (report) {
        var results = [];
        Object.keys(ssrcs).forEach(function (ssrc) {
            var ssrcInfo = ssrcs[ssrc];
            var rtpStat = findStat(report, ssrc, ssrcInfo.direction, false);
            var rtcpStat = findStat(report, ssrc, ssrcInfo.direction, true);
            if (rtpStat && rtcpStat) {
                var parsedStat = {};
                parsedStat.media = ssrcInfo.media;
                parsedStat.direction = ssrcInfo.direction;
                if (ssrcInfo.direction === 'in') {
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
    var processW3C = function (report) {
        // see https://w3c.github.io/webrtc-stats/#rtcstatstype-str* for the enum
        var results = [];
        Object.keys(ssrcs).forEach(function (ssrc) {
            var ssrcInfo = ssrcs[ssrc];
            var type = ssrcInfo.direction === 'in' ? 'inbound-rtp' : 'outbound-rtp';
            report.forEach(function (obj) {
                if (obj.type === type && +obj.ssrc === +ssrc) {
                    var parsedStat = {
                        media: ssrcInfo.media,
                        direction: ssrcInfo.direction
                    };
                    if (ssrcInfo.direction === 'in') {
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
    var start = function (peerConnection) {
        if (stats_timer === -1) {
            logger.debug('Starting stats timer');
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
    var stop = function () {
        if (stats_timer !== -1) {
            logger.debug('Stopping stats timer');
            window.clearInterval(stats_timer);
            stats_timer = -1;
            ssrcs = {};
        }
    };
    var processSdp = function (data) {
        var session = SdpInterop.transform.parse(data.sdp);
        var numVideo = 0;
        // we will keep track of which mline each ssrc is from, so that if it is disabled
        // we can remove it from the list
        var direction = data.originator === 'remote' ? 'in' : 'out';
        session.media.forEach(function (mline, index) {
            if (mline.sources && Object.keys(mline.sources).length === 1) {
                var ssrc = Object.keys(mline.sources)[0];
                var ssrcEntry = {
                    pkts: 0,
                    bytes: 0,
                    lost: 0,
                    pliCount: 0,
                    index: index,
                    direction: direction,
                    media: mline.type
                };
                if (mline.type === 'video') {
                    numVideo++;
                }
                if (ssrcEntry.media === 'video' && numVideo > 1) {
                    ssrcEntry.media = 'pc'; //dig out the PC entries.
                }
                if (typeof ssrcs[ssrc] === 'undefined') {
                    ssrcs[ssrc] = ssrcEntry;
                }
            }
            else if (mline.port === 0) {
                var purged_1 = {};
                Object.keys(ssrcs).forEach(function (ssrc) {
                    var ssrcInfo = ssrcs[ssrc];
                    if (ssrcInfo.index !== index) {
                        purged_1[ssrc] = ssrcInfo;
                    }
                });
                ssrcs = purged_1;
            }
            else {
                logger.warn('Unusual mline in SDP, cannot parse single ssrc ');
            }
        });
    };
    var that = {
        start: start,
        stop: stop,
        processSdp: processSdp
    };
    return that;
}
exports.StatsManager = StatsManager;
