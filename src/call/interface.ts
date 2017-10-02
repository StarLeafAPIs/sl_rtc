import { createSecureClient } from 'xmlrpc';
import { Call } from './call';
import { ILogger } from '../sl';

export type MediaOptions = {
    mediaConstraints?: MediaStreamConstraints;
    mediaStream?: MediaStream;
    rtcOfferConstraints?: RTCOfferOptions;
};

export function createCall(
    target: string,
    display_name: string,
    logger?: ILogger,
    portal = 'portal.starleaf.com'
): Promise<SlCall> {
    let client = createSecureClient({
        url: 'https://' + portal + '/RPC2',
        cookies: true
    });
    if (!logger) {
        logger = DummyLogger();
    }
    return new Promise<SlCall>((resolve, reject) => {
        client.methodCall('getDialStringConfig', [undefined, target], (error, value) => {
            if (error) {
                reject(error);
            } else {
                let call_domain: string = value.org_calling_domain || value.orgCallingDomain;
                let cfg = {
                    target: target,
                    display_name: display_name,
                    call_domain: call_domain
                };
                let call = Call(cfg, logger as ILogger, false);
                resolve(call);
            }
        });
    });
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

export enum PCState {
    SEND = 0,
    RECV,
    DISABLED
}

export interface CallEventMap {
    ringing: () => void;
    in_call: () => void;
    renegotiated: () => void;
    audioonly: (is_audio_only: boolean) => void;
    addstream: (stream: MediaStream) => void;
    removestream: (stream: MediaStream) => void;
    pcstate: (pc_state: PCState) => void;
    ending: () => void;
    ended: () => void;
}

export type MediaType = 'audio' | 'video';
export type MuteState = { [k in MediaType]?: boolean };

export type CallConfig = {
    target: string;
    call_domain: string;
    display_name: string;
};

export interface SlCall {
    on<K extends keyof CallEventMap>(event: K, listener: CallEventMap[K]): void;
    dial(options: MediaOptions): void;
    hangup(): void;
    mute(mute: MuteState): boolean;
    isMuted(): MuteState;
    addPCStream(stream: MediaStream): void;
    removePCStream(stream: MediaStream): void;
}

function DummyLogger(): ILogger {
    return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        sub: (prefix: string): ILogger => {
            return DummyLogger();
        }
    };
}
