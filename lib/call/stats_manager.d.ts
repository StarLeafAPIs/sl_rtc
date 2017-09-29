import { ILogger } from '../sl';
import { SdpData } from './sdp_munger';
export declare function StatsManager(period: number, logger: ILogger): {
    start: (peerConnection: RTCPeerConnection) => void;
    stop: () => void;
    processSdp: (data: SdpData) => void;
};
