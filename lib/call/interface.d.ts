import { ILogger } from "../sl";
export declare function createCall(target: string, display_name: string, logger?: ILogger, api_host?: string): Promise<SlCall>;
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
    UNAVAILABLE = 11
}
export declare enum PCState {
    SEND = 0,
    RECV = 1,
    DISABLED = 2
}
export interface CallEventMap {
    ringing: () => void;
    in_call: () => void;
    renegotiated: () => void;
    audio_only: (is_audio_only: boolean) => void;
    add_stream: (stream: MediaStream) => void;
    remove_stream: (stream: MediaStream) => void;
    pc_state: (pc_state: PCState) => void;
    ending: () => void;
    ended: (reason: CallEndReason) => void;
}
export declare type MediaType = "audio" | "video";
export declare type MuteState = {
    [k in MediaType]?: boolean;
};
export interface SlCall {
    on<K extends keyof CallEventMap>(event: K, listener: CallEventMap[K]): void;
    dial(local_stream: MediaStream): void;
    hangup(): void;
    mute(mute: MuteState): boolean;
    isMuted(): MuteState;
    addPCStream(stream: MediaStream): void;
    removePCStream(stream: MediaStream): void;
}
