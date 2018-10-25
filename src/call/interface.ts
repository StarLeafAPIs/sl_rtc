/*
* Copyright (c) StarLeaf Limited, 2017
*/

import { Call } from "./call";
import { ILogger } from "../sl";

export function createCall(target: string, display_name: string, logger?: ILogger, api_host?: string): Promise<SlCall> {
    if (!logger) {
        logger = new DummyLogger();
    }
    if (!api_host) {
        api_host = "api.starleaf.com";
    }
    return new Promise<SlCall>((resolve, reject) => {
        let api_url = "https://" + api_host + "/v1/webrtc/org_domain?target=" + encodeURIComponent(target);
        fetch(api_url, {
            method: "GET",
            cache: "no-cache"
        })
            .then(response => {
                if (response.ok) {
                    return response.json();
                } else {
                    throw "Request failed";
                }
            })
            .then(json => {
                let cfg = {
                    target: target,
                    display_name: display_name,
                    org_domain: json.org_domain,
                    capi_version: json.capi_version
                };
                let call = Call(cfg, logger as ILogger, false);
                resolve(call);
            })
            .catch((error: any) => {
                reject(error);
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
    UNAVAILABLE
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
    audio_only: (is_audio_only: boolean) => void;
    add_stream: (stream: MediaStream) => void;
    remove_stream: (stream: MediaStream) => void;
    pc_state: (pc_state: PCState) => void;
    ending: () => void;
    ended: (reason: CallEndReason) => void;
}

export type MediaType = "audio" | "video";
export type MuteState = { [k in MediaType]?: boolean };

export interface SlCall {
    on<K extends keyof CallEventMap>(event: K, listener: CallEventMap[K]): void;
    dial(local_stream: MediaStream): void;
    hangup(): void;
    mute(mute: MuteState): boolean;
    isMuted(): MuteState;
    addPCStream(stream: MediaStream): void;
    removePCStream(stream: MediaStream): void;
}

class DummyLogger implements ILogger {
    debug(...args: any[]) {}
    info(...args: any[]) {}
    warn(...args: any[]) {}
    error(...args: any[]) {}
    sub(prefix: string) {
        return this;
    }
}
