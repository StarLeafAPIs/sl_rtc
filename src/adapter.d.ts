declare module 'webrtc-adapter/out/adapter' {
    function log(): void;
    function deprecated(): void;
    function disableLog(): void;
    function disableWarnings(): void;
    function extractVersion(): void;
    function shimCreateObjectURL(): void;
    function detectBrowser(): string;
}
