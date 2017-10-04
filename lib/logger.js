"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var sprintf_1 = require("sprintf");
exports.levels = ['D', 'I', 'W', 'E'];
var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var indent = 2;
var maxdepth = 4; // maximum depth it will recurse through an objects properties
var Logger = /** @class */ (function () {
    function Logger(module, output, consoleLogging) {
        this.module = module;
        this.output = output;
        this.consoleLogging = consoleLogging;
    }
    Logger.padRight = function (value, length) {
        if (value.length >= length) {
            return value;
        }
        var diff = length - value.length;
        for (var i = 0; i < diff; i++) {
            value += ' ';
        }
        return value;
    };
    Logger.prototype.printToConsole = function (level, messages) {
        var prefix = sprintf_1.sprintf('%s %s: ', exports.levels[level], this.module);
        var args = [prefix];
        for (var i = 0; i < messages.length; i++) {
            args.push(messages[i]);
        }
        if (level === 0) {
            console.debug.apply(console, args);
        }
        else if (level === 1) {
            console.info.apply(console, args);
        }
        else if (level === 2) {
            console.warn.apply(console, args);
        }
        else if (level === 3) {
            console.error.apply(console, args);
        }
    };
    Logger.prototype.logImpl = function (lineStart, msg, indent, currentdepth) {
        if (currentdepth >= maxdepth) {
            return;
        }
        if (typeof msg === 'undefined' || msg === null) {
            return;
        }
        lineStart = Logger.padRight(lineStart, lineStart.length + indent);
        var i = 0;
        if (msg.constructor === Array) {
            for (i = 0; i < msg.length; i++) {
                this.logImpl(lineStart, msg[i], indent, currentdepth + 1);
            }
        }
        else if (typeof msg === 'string') {
            var msgLines = msg.split('\n');
            for (i = 0; i < msgLines.length; i++) {
                this.output(lineStart + msgLines[i] + '\n');
            }
        }
        else if (typeof msg === 'number' || typeof msg === 'boolean') {
            this.output(lineStart + msg + '\n');
        }
        else {
            // some other object, just go through its properties and log them
            var keys = Object.keys(msg);
            for (i = 0; i < keys.length; i++) {
                this.logImpl(lineStart + keys[i] + ': ', msg[keys[i]], indent, currentdepth + 1);
            }
        }
    };
    Logger.prototype.log = function (level, args) {
        if (this.consoleLogging) {
            this.printToConsole(level, args);
        }
        var time = new Date();
        var lineStart = sprintf_1.sprintf('%1s %4u %3s %u %02u:%02u:%02u.%0-3u %-30s', exports.levels[level], time.getUTCFullYear(), months[time.getUTCMonth()], time.getUTCDate(), time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(), time.getUTCMilliseconds(), this.module);
        var compoundMessage = '';
        var i = 0;
        for (; i < args.length; i++) {
            if (typeof args[i] === 'number' || typeof args[i] === 'boolean') {
                compoundMessage += args[i];
            }
            else if (typeof args[i] === 'string' &&
                args[i].split('\n').length === 1) {
                compoundMessage += args[i];
            }
            else {
                break;
            }
        }
        if (compoundMessage !== '') {
            this.logImpl(lineStart, compoundMessage, 0, 0);
        }
        for (; i < args.length; i++) {
            this.logImpl(lineStart, args[i], indent, 0);
        }
    };
    Logger.prototype.sub = function (subModule, subConsoleLogging) {
        if (subConsoleLogging === undefined) {
            subConsoleLogging = this.consoleLogging;
        }
        return new Logger(this.module + '/' + subModule, this.output, subConsoleLogging);
    };
    Logger.prototype.debug = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return this.log(0, args);
    };
    Logger.prototype.info = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return this.log(1, args);
    };
    Logger.prototype.warn = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return this.log(2, args);
    };
    Logger.prototype.error = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return this.log(3, args);
    };
    return Logger;
}());
exports.Logger = Logger;
