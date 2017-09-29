export const GumErrors = {
    NOT_READABLE: 'NotReadableError',
    NOT_ALLOWED: 'NotAllowedError',
    PERMISSION_DENIED: 'PermissionDeniedError',
    PERMISSION_DISMISSED: 'PermissionDismissedError',
    OVERCONSTRAINED: 'OverconstrainedError',
    NOT_FOUND: 'NotFoundError',
    SECURITY: 'SecurityError'
};

export interface DeviceInfo {
    id: string;
    label: string;
    text: string;
}

export type DeviceType = 'audioinput' | 'audiooutput' | 'videoinput';

export type DeviceList = { [k in DeviceType]: DeviceInfo[] };
