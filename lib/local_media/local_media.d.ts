import { ILogger } from '../sl';
import { DeviceList } from './constants';
export interface LocalMediaRequest {
    audio?: {
        id?: string;
    };
    video?: {
        id?: string;
    };
}
export declare function LocalMedia(spec: {
    logger: ILogger;
    plugin: boolean;
}): {
    getDevices: () => Promise<DeviceList>;
    getMediaStream: (request: LocalMediaRequest) => Promise<MediaStream>;
    cachedDevices: () => DeviceList;
};
