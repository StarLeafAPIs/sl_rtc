export enum PCState {
    SEND = 0,
    RECV,
    DISABLED
}

export enum CallEndReason {
    USER_BYE = 0,
    REMOTE_BYE,
    BUSY,
    NOT_FOUND,
    REJECTED,
    CONNECTION_ERROR,
    CONNECTION_TIMEOUT,
    CONNECTION_REFUSED,
    ICE_FAILURE,
    SIP_ERROR,
    INTERNAL_ERROR,
    UNAVAILABLE,
    PLUGIN_CRASH
}

export type media_type = 'audio' | 'video';
export type MuteState = { [k in media_type]?: boolean };

export interface CallObj {
    on: (event: string, handler: (result: any) => void) => void;
    dial: (target: string, options: any) => void;
    hangup: () => void;
    mute: (mute: MuteState) => boolean;
    isMuted: () => MuteState;
    addPCStream: (stream: MediaStream) => void;
    removePCStream: (stream: MediaStream) => void;
}
