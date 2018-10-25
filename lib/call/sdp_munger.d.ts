import { ILogger } from "../sl";
import { PCState } from "./interface";
export declare type Orginator = "remote" | "local";
export declare type SdpType = "offer" | "answer" | null;
export interface SdpData extends RTCSessionDescription {
    originator: Orginator;
    await: () => () => void;
}
export declare function SdpMunger(base_logger: ILogger, logSdp: boolean, allowH264: boolean): {
    mungeRemote: (data: SdpData) => void;
    mungeLocal: (data: SdpData) => void;
    isAudioOnly: (sdp: any) => boolean;
    getPcState: (data: SdpData) => PCState;
    onIceComplete: (pc: RTCPeerConnection, audioOnly: boolean, callback: any) => void;
    setLocalMedia: (stream?: MediaStream | undefined) => void;
    stop: () => void;
};
