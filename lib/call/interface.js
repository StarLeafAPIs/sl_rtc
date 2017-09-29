"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var xmlrpc_1 = require("xmlrpc");
var call_1 = require("./call");
function createCall(target, display_name, logger, portal) {
    if (portal === void 0) { portal = 'portal.starleaf.com'; }
    var client = xmlrpc_1.createSecureClient({
        url: 'https://' + portal + '/RPC2',
        cookies: true,
    });
    if (!logger) {
        logger = DummyLogger();
    }
    return new Promise(function (resolve, reject) {
        client.methodCall('getDialStringConfig', [undefined, target], function (error, value) {
            if (error) {
                reject(error);
            }
            else {
                var call_domain = value.org_calling_domain || value.orgCallingDomain;
                var cfg = {
                    target: target,
                    display_name: display_name,
                    websocket_address: 'wss://' + call_domain + ':443'
                };
                var call = call_1.Call(cfg, logger, false);
                resolve(call);
            }
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
    CallEndReason[CallEndReason["PLUGIN_CRASH"] = 12] = "PLUGIN_CRASH";
})(CallEndReason = exports.CallEndReason || (exports.CallEndReason = {}));
var PCState;
(function (PCState) {
    PCState[PCState["SEND"] = 0] = "SEND";
    PCState[PCState["RECV"] = 1] = "RECV";
    PCState[PCState["DISABLED"] = 2] = "DISABLED";
})(PCState = exports.PCState || (exports.PCState = {}));
function DummyLogger() {
    return {
        debug: function () { },
        info: function () { },
        warn: function () { },
        error: function () { },
        sub: function (prefix) {
            return DummyLogger();
        }
    };
}
