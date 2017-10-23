/*
* Copyright (c) StarLeaf Limited, 2017
*/

import * as sl from '../sl';
import { ILogger } from '../sl';
import * as SdpInterop from 'sdp-interop-sl';
import { SdpData } from './sdp_munger';
import { sprintf } from 'sprintf';

export function StatsManager(period: number, logger: ILogger) {
    let period_seconds = period / 1000.0;
    let stats_timer: number = -1;

    let ssrcs: { [key: string]: any } = {};

    let onStats = function(data: any) {
        let parsed_w3c = false;
        try {
            parsed_w3c = processW3C(data);
        } catch (ex) {
            // If parsing the standard defined stats fails, use the older browser specific parse functions
        }
        if (!parsed_w3c) {
            if (sl.detectedBrowser === 'firefox') {
                processFirefox(data);
            } else {
                processChrome(data);
            }
        }
    };

    let onFailure = function(reason: DOMError) {
        logger.error('Failed to get stats because: ', reason);
    };

    function isDefined(thing: any) {
        return typeof thing !== 'undefined';
    }

    let logResults = function(results: any[]) {
        for (let i = 0; i < results.length; i++) {
            let stat = results[i];
            let logline = sprintf('%s-%s:', stat.media, stat.direction);
            logline +=
                ' pkts/s=' + (isDefined(stat.pktrate) ? sprintf('%d', stat.pktrate) : 'unknown');
            logline += ' kbps=' + (isDefined(stat.kbps) ? sprintf('%d', stat.kbps) : 'unknown');
            if (isDefined(stat.lost)) {
                logline += ' lost=' + stat.lost;
            }
            if (isDefined(stat.pliCount)) {
                logline += ' plis=' + stat.pliCount;
            }
            logline += isDefined(stat.rtt) ? sprintf(' rtt=%d', stat.rtt) : '';
            logger.debug(logline);
        }
    };
    // for reference, a plus sign is an implicit conversion to the number type.

    let commonSendStats = function(result: any, ssrc_info: any, raw_stats: any) {
        result.pktrate = (+raw_stats.packetsSent - ssrc_info.pkts) / period_seconds;
        result.kbps = (+raw_stats.bytesSent - ssrc_info.bytes) * 8.0 / (period_seconds * 1000.0);
        if (typeof raw_stats.pliCount !== 'undefined') {
            // for video at least we can count the PLI's
            result.pliCount = +raw_stats.pliCount - ssrc_info.pliCount;
            ssrc_info.pliCount = +raw_stats.pliCount;
        }
        if (typeof raw_stats.googRtt !== 'undefined') {
            result.rtt = +raw_stats.googRtt;
        } else if (typeof raw_stats.roundTripTime !== 'undefined') {
            result.rtt = +raw_stats.roundTripTime;
        }
        ssrc_info.pkts = +raw_stats.packetsSent;
        ssrc_info.bytes = +raw_stats.bytesSent;
    };

    let commonRecvStats = function(result: any, ssrcInfo: any, rawStats: any) {
        result.pktrate = (+rawStats.packetsReceived - ssrcInfo.pkts) / period_seconds;
        result.kbps = (+rawStats.bytesReceived - ssrcInfo.bytes) * 8.0 / (period_seconds * 1000.0);
        result.lost = +rawStats.packetsLost - ssrcInfo.lost;
        ssrcInfo.pkts = +rawStats.packetsReceived;
        ssrcInfo.bytes = +rawStats.bytesReceived;
        ssrcInfo.lost = +rawStats.packetsLost;
    };

    let processChrome = function(report: any) {
        function process(stats: any, ssrc_info: any) {
            let parsed_stat: { [key: string]: any } = {};
            parsed_stat.media = ssrc_info.media;
            parsed_stat.direction = ssrc_info.direction;
            if (typeof stats.bytesSent !== 'undefined') {
                if (typeof stats.audioInputLevel !== 'undefined') {
                    commonSendStats(parsed_stat, ssrc_info, stats);
                } else {
                    commonSendStats(parsed_stat, ssrc_info, stats);
                }
            } else {
                if (typeof stats.audioOutputLevel !== 'undefined') {
                    commonRecvStats(parsed_stat, ssrc_info, stats);
                } else {
                    commonRecvStats(parsed_stat, ssrc_info, stats);
                }
            }
            results.push(parsed_stat);
        }

        function parseKey(key: string) {
            return key
                .replace('ssrc_', '')
                .replace('_recv', '')
                .replace('_send', '');
        }

        let results: any[] = [];
        if (typeof report.forEach !== 'undefined') {
            report.forEach(function(value: any, key: string) {
                if (value.type === 'ssrc') {
                    let parsed_key = parseKey(key);
                    if (typeof ssrcs[parsed_key] !== 'undefined') {
                        process(value, ssrcs[parsed_key]);
                    }
                }
            });
        } else {
            Object.keys(report).forEach(function(key) {
                if (report[key].type === 'ssrc') {
                    let parsedKey = parseKey(key);
                    if (typeof ssrcs[parsedKey] !== 'undefined') {
                        process(report[key], ssrcs[parsedKey]);
                    }
                }
            });
        }
        logResults(results);
    };

    let findStat = function(report: any, ssrc: string, direction: string, rtcp: boolean) {
        let test = direction === 'in';
        if (rtcp) {
            test = !test;
        } // firefox labels the rtcp it produces for the outbound rtp as 'inboundrtp' for some reason
        let old_type = test ? 'inboundrtp' : 'outboundrtp';
        // WebRTC spec says these stats should have dashes
        let new_type = test ? 'inbound-rtp' : 'outbound-rtp';
        let result = null;
        report.forEach((stat: any) => {
            if (typeof stat.ssrc !== 'undefined' && typeof stat.type !== 'undefined') {
                if (stat.ssrc === ssrc && (stat.type === old_type || stat.type === new_type)) {
                    result = stat;
                }
            }
        });
        return result;
    };

    let processFirefox = (report: any) => {
        let results: any[] = [];
        Object.keys(ssrcs).forEach(function(ssrc) {
            let ssrcInfo = ssrcs[ssrc];
            let rtpStat: any = findStat(report, ssrc, ssrcInfo.direction, false);
            let rtcpStat: any = findStat(report, ssrc, ssrcInfo.direction, true);
            if (rtpStat && rtcpStat) {
                let parsedStat: any = {};
                parsedStat.media = ssrcInfo.media;
                parsedStat.direction = ssrcInfo.direction;
                if (ssrcInfo.direction === 'in') {
                    commonRecvStats(parsedStat, ssrcInfo, rtpStat);
                } else {
                    rtpStat.packetsLost = rtcpStat.packetsLost;
                    rtpStat.roundTripTime = rtcpStat.mozRtt;
                    commonSendStats(parsedStat, ssrcInfo, rtpStat);
                }
                results.push(parsedStat);
            }
        });
        logResults(results);
    };

    let processW3C = function(report: any) {
        // see https://w3c.github.io/webrtc-stats/#rtcstatstype-str* for the enum
        let results: any[] = [];
        Object.keys(ssrcs).forEach(function(ssrc: any) {
            let ssrcInfo = ssrcs[ssrc];
            let type = ssrcInfo.direction === 'in' ? 'inbound-rtp' : 'outbound-rtp';
            report.forEach(function(obj: any) {
                if (obj.type === type && +obj.ssrc === +ssrc) {
                    let parsedStat = {
                        media: ssrcInfo.media,
                        direction: ssrcInfo.direction
                    };
                    if (ssrcInfo.direction === 'in') {
                        commonRecvStats(parsedStat, ssrcInfo, obj);
                    } else {
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

    let start = function(peerConnection: RTCPeerConnection) {
        if (stats_timer === -1) {
            logger.debug('Starting stats timer');
            stats_timer = window.setInterval(function() {
                try {
                    peerConnection
                        .getStats(null)
                        .then(onStats)
                        .catch(onFailure);
                } catch (ex) {
                    // Temasys plugin doesn't support promise based peerConnection.getStats()
                    peerConnection.getStats(null, onStats, onFailure);
                }
            }, period);
        }
    };

    let stop = function() {
        if (stats_timer !== -1) {
            logger.debug('Stopping stats timer');
            window.clearInterval(stats_timer);
            stats_timer = -1;
            ssrcs = {};
        }
    };

    let processSdp = function(data: SdpData) {
        let session = SdpInterop.transform.parse(data.sdp);
        let numVideo = 0;

        // we will keep track of which mline each ssrc is from, so that if it is disabled
        // we can remove it from the list

        let direction = data.originator === 'remote' ? 'in' : 'out';
        session.media.forEach(function(mline: any, index: number) {
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
                if (mline.type === 'video') {
                    numVideo++;
                }
                if (ssrcEntry.media === 'video' && numVideo > 1) {
                    ssrcEntry.media = 'pc'; //dig out the PC entries.
                }
                if (typeof ssrcs[ssrc] === 'undefined') {
                    ssrcs[ssrc] = ssrcEntry;
                }
            } else if (mline.port === 0) {
                let purged: any = {};
                Object.keys(ssrcs).forEach(function(ssrc) {
                    let ssrcInfo = ssrcs[ssrc];
                    if (ssrcInfo.index !== index) {
                        purged[ssrc] = ssrcInfo;
                    }
                });
                ssrcs = purged;
            } else {
                logger.warn('Unusual mline in SDP, cannot parse single ssrc ');
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
