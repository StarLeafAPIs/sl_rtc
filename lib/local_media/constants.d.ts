export declare const GumErrors: {
    NOT_READABLE: string;
    NOT_ALLOWED: string;
    PERMISSION_DENIED: string;
    PERMISSION_DISMISSED: string;
    OVERCONSTRAINED: string;
    NOT_FOUND: string;
    SECURITY: string;
};
export interface DeviceInfo {
    id: string;
    label: string;
    text: string;
}
export declare type DeviceType = 'audioinput' | 'audiooutput' | 'videoinput';
export declare type DeviceList = {
    [k in DeviceType]: DeviceInfo[];
};
