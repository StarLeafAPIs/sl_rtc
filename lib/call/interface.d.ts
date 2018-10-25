import { ILogger } from "../sl";
export declare function createCall(target: string, display_name: string, media_stream?: MediaStream, logger?: ILogger, api_host?: string): Promise<SlCall>;
export declare enum ContentState {
    SEND = 0,
    RECV = 1,
    DISABLED = 2
}
export declare enum CallEndReason {
    USER_BYE = 0,
    REMOTE_BYE = 1,
    BUSY = 2,
    NOT_FOUND = 3,
    REJECTED = 4,
    CONNECTION_ERROR = 5,
    CONNECTION_TIMEOUT = 6,
    CONNECTION_REFUSED = 7,
    ICE_FAILURE = 8,
    SIP_ERROR = 9,
    INTERNAL_ERROR = 10,
    UNAVAILABLE = 11,
    PLUGIN_CRASH = 12
}
export declare type MediaType = "audio" | "video";
export declare type MuteState = {
    [k in MediaType]: boolean;
};
export declare type CallConfig = {
    target: string;
    display_name: string;
    org_domain: string;
    capi_version: number;
};
export interface SlCall {
    on<K extends keyof CallEventMap>(event: K, listener: CallEventMap[K]): void;
    dial(): void;
    hangup(): void;
    mute(mute: MuteState): boolean;
    isMuted(): MuteState;
    startContent(stream: MediaStream): void;
    endContent(): void;
}
export interface CallEventMap {
    ringing: () => void;
    in_call: () => void;
    ice_reinvite_complete: () => void;
    content_reinvite_complete: () => void;
    audio_only: (is_audio_only: boolean) => void;
    remote_video: (stream: MediaStream) => void;
    remote_content: (stream?: MediaStream) => void;
    local_content: (stream?: MediaStream) => void;
    ending: () => void;
    ended: (reason: CallEndReason) => void;
}
