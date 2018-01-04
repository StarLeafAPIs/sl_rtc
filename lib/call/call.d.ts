import { ILogger } from '../sl';
import { SlCall } from './interface';
export declare type CallConfig = {
    target: string;
    org_domain: string;
    capi_version: number;
    display_name: string;
};
export declare function Call(config_: CallConfig, base_logger: ILogger, logSdp: boolean): SlCall;
