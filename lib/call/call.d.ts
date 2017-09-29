import { ILogger } from '../sl';
import { SlCall } from './interface';
export declare type CallConfig = {
    target: string;
    websocket_address: string;
    display_name: string;
};
export declare function Call(config_: CallConfig, base_logger: ILogger, logSdp: boolean): SlCall;
