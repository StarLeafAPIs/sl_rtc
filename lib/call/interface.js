"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const call_1 = require("./call");
function createCall(target, display_name, logger) {
    if (!logger) {
        logger = new DummyLogger();
    }
    return new Promise((resolve, reject) => {
        let api_url = 'https://api.starleaf.com/v1/webrtc/org_domain' +
            '?version=latest&target=' +
            encodeURIComponent(target);
        fetch(api_url, {
            method: 'GET'
        })
            .then(response => {
            if (response.ok) {
                return response.json();
            }
            else {
                throw 'Request failed';
            }
        })
            .then(json => {
            let cfg = {
                target: target,
                display_name: display_name,
                org_domain: json.org_domain
            };
            let call = call_1.Call(cfg, logger, false);
            resolve(call);
        })
            .catch((error) => {
            reject(error);
        });
    });
}
exports.createCall = createCall;
var CallEndReason;
(function (CallEndReason) {
    CallEndReason[CallEndReason["USER_BYE"] = 0] = "USER_BYE";
    CallEndReason[CallEndReason["REMOTE_BYE"] = 1] = "REMOTE_BYE";
    CallEndReason[CallEndReason["BUSY"] = 2] = "BUSY";
    CallEndReason[CallEndReason["NOT_FOUND"] = 3] = "NOT_FOUND";
    CallEndReason[CallEndReason["REJECTED"] = 4] = "REJECTED";
    CallEndReason[CallEndReason["CONNECTION_ERROR"] = 5] = "CONNECTION_ERROR";
    CallEndReason[CallEndReason["CONNECTION_TIMEOUT"] = 6] = "CONNECTION_TIMEOUT";
    CallEndReason[CallEndReason["CONNECTION_REFUSED"] = 7] = "CONNECTION_REFUSED";
    CallEndReason[CallEndReason["ICE_FAILURE"] = 8] = "ICE_FAILURE";
    CallEndReason[CallEndReason["SIP_ERROR"] = 9] = "SIP_ERROR";
    CallEndReason[CallEndReason["INTERNAL_ERROR"] = 10] = "INTERNAL_ERROR";
    CallEndReason[CallEndReason["UNAVAILABLE"] = 11] = "UNAVAILABLE";
})(CallEndReason = exports.CallEndReason || (exports.CallEndReason = {}));
var PCState;
(function (PCState) {
    PCState[PCState["SEND"] = 0] = "SEND";
    PCState[PCState["RECV"] = 1] = "RECV";
    PCState[PCState["DISABLED"] = 2] = "DISABLED";
})(PCState = exports.PCState || (exports.PCState = {}));
class DummyLogger {
    debug(...args) { }
    info(...args) { }
    warn(...args) { }
    error(...args) { }
    sub(prefix) {
        return this;
    }
}
