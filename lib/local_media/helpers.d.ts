import { DeviceInfo } from './constants';
export declare function deleteDeviceCookies(): void;
export declare function audioConstraints(mic_id: string | undefined, device_list: DeviceInfo[], plugin: boolean): {
    sourceId: {
        exact: string;
    } | undefined;
} | {
    deviceId: {
        exact: string;
    } | undefined;
};
export declare function videoConstraints(camera_id: string | undefined, device_list: DeviceInfo[], plugin: boolean): {
    optional: {
        sourceId: string;
    }[];
} | {
    width: number;
    height: number;
    frameRate: number;
} | {
    deviceId: {
        exact: string;
    } | undefined;
    width: number;
    height: number;
    frameRate: number;
} | undefined;
export declare function setSpeaker(elements: HTMLVideoElement[], speaker_id: string | undefined, device_list: DeviceInfo[]): string;
export declare function muteVideo(video: HTMLVideoElement, muted?: boolean): void;
export declare function recreateVideo(elem: HTMLVideoElement, muted?: boolean): HTMLVideoElement;
export declare function hasLocalMedia(stream?: MediaStream): {
    audio: boolean;
    video: boolean;
};
export declare const resize_tgt_tag = "data-resize-tgt";
export declare function fitVideo(elem: HTMLVideoElement): {
    width: number;
    height: number;
};
