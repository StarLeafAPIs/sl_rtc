import { ILogger } from "../sl";
import { ContentState } from "./interface";
export declare type Orginator = "remote" | "local";
export declare type SdpType = "offer" | "answer";
export interface SdpData {
    originator: Orginator;
    sdp: string;
    type: SdpType;
    await_sdp: () => () => void;
}
export declare function SdpMunger(base_logger: ILogger, logSdp: boolean): {
    mungeRemote: (data: SdpData) => void;
    mungeLocal: (data: SdpData) => void;
    isAudioOnly: (sdp: any) => boolean;
    getContentState: (data: SdpData) => ContentState;
    disableContent: (data: SdpData) => void;
};
