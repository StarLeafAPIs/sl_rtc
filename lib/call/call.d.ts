import { ILogger } from "../sl";
import { SlCall, CallConfig } from "./interface";
export declare function Call(config_: CallConfig, base_logger: ILogger, logSdp: boolean, media_stream?: MediaStream): SlCall;
