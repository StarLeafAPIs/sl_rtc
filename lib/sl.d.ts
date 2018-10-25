export declare var detectedBrowser: string;
export declare var detectedVersion: string | number;
export declare const browser_name: string;
export declare const browser_version: number;
export declare function hasLocalMedia(stream?: MediaStream): {
    audio: boolean;
    video: boolean;
};
export { ILogger, Logger } from './logger';
