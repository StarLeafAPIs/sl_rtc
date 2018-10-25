/*
* Copyright (c) StarLeaf Limited, 2017
*/

import { Call } from "./call";
import { ILogger } from "../sl";

export function createCall(
    target: string,
    display_name: string,
    media_stream?: MediaStream,
    logger?: ILogger,
    api_host?: string
): Promise<SlCall> {
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
                let call = Call(cfg, logger as ILogger, false, media_stream);
                resolve(call);
            })
            .catch((error: any) => {
                reject(error);
            });
    });
}

export enum ContentState {
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

export type MediaType = "audio" | "video";
export type MuteState = { [k in MediaType]: boolean };

export type CallConfig = {
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
    content_reinvite_complete: () => void; // Will notify you when the SIP re-invite is complete after adding or removing content. Await this before adding or removing content again.
    audio_only: (is_audio_only: boolean) => void;
    remote_video: (stream: MediaStream) => void; // Will notify you when the remote a/v stream is added
    remote_content: (stream?: MediaStream) => void; // Will notify you when remote content is added or removed (stream will be undefined it was removed)
    local_content: (stream?: MediaStream) => void; // Will notify you when local content is added and removed.
    ending: () => void;
    ended: (reason: CallEndReason) => void;
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
