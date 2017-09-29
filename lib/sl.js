"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var adapter = require("webrtc-adapter");
exports.detectedBrowser = adapter.browserDetails.browser;
exports.detectedVersion = adapter.browserDetails.version;
