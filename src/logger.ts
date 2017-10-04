import { sprintf } from 'sprintf';
export const levels = ['D', 'I', 'W', 'E'];

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const indent = 2;
const maxdepth = 4; // maximum depth it will recurse through an objects properties

export class Logger {
    module: string;
    output: (msg: string) => any;
    consoleLogging: boolean;

    constructor(module: string, output: (msg: string) => any, consoleLogging: boolean) {
        this.module = module;
        this.output = output;
        this.consoleLogging = consoleLogging;
    }

    static padRight(value: string, length: number): string {
        if (value.length >= length) {
            return value;
        }
        let diff = length - value.length;
        for (let i = 0; i < diff; i++) {
            value += ' ';
        }
        return value;
    }

    printToConsole(level: number, messages: string[]): void {
        let prefix = sprintf('%s %s: ', levels[level], this.module);
        let args = [prefix];
        for (let i = 0; i < messages.length; i++) {
            args.push(messages[i]);
        }

        if (level === 0) {
            console.debug.apply(console, args);
        } else if (level === 1) {
            console.info.apply(console, args);
        } else if (level === 2) {
            console.warn.apply(console, args);
        } else if (level === 3) {
            console.error.apply(console, args);
        }
    }

    logImpl(lineStart: string, msg: any, indent: number, currentdepth: number): void {
        if (currentdepth >= maxdepth) {
            return;
        }
        if (typeof msg === 'undefined' || msg === null) {
            return;
        }
        lineStart = Logger.padRight(lineStart, lineStart.length + indent);

        let i = 0;

        if (msg.constructor === Array) {
            for (i = 0; i < msg.length; i++) {
                this.logImpl(lineStart, msg[i], indent, currentdepth + 1);
            }
        } else if (typeof msg === 'string') {
            let msgLines = msg.split('\n');
            for (i = 0; i < msgLines.length; i++) {
                this.output(lineStart + msgLines[i] + '\n');
            }
        } else if (typeof msg === 'number' || typeof msg === 'boolean') {
            this.output(lineStart + msg + '\n');
        } else {
            // some other object, just go through its properties and log them
            let keys = Object.keys(msg);
            for (i = 0; i < keys.length; i++) {
                this.logImpl(lineStart + keys[i] + ': ', msg[keys[i]], indent, currentdepth + 1);
            }
        }
    }

    log(level: number, args: any[]): void {
        if (this.consoleLogging) {
            this.printToConsole(level, args);
        }
        let time = new Date();
        let lineStart = sprintf(
            '%1s %4u %3s %u %02u:%02u:%02u.%0-3u %-30s',
            levels[level],
            time.getUTCFullYear(),
            months[time.getUTCMonth()],
            time.getUTCDate(),
            time.getUTCHours(),
            time.getUTCMinutes(),
            time.getUTCSeconds(),
            time.getUTCMilliseconds(),
            this.module
        );

        let compoundMessage = '';
        let i = 0;
        for (; i < args.length; i++) {
            if (typeof args[i] === 'number' || typeof args[i] === 'boolean') {
                compoundMessage += args[i];
            } else if (
                typeof args[i] === 'string' &&
                (args[i] as string).split('\n').length === 1
            ) {
                compoundMessage += args[i];
            } else {
                break;
            }
        }
        if (compoundMessage !== '') {
            this.logImpl(lineStart, compoundMessage, 0, 0);
        }
        for (; i < args.length; i++) {
            this.logImpl(lineStart, args[i], indent, 0);
        }
    }

    sub(subModule: string, subConsoleLogging?: boolean): Logger {
        if (subConsoleLogging === undefined) {
            subConsoleLogging = this.consoleLogging;
        }
        return new Logger(this.module + '/' + subModule, this.output, subConsoleLogging);
    }

    debug(...args: any[]): void {
        return this.log(0, args);
    }

    info(...args: any[]): void {
        return this.log(1, args);
    }

    warn(...args: any[]): void {
        return this.log(2, args);
    }

    error(...args: any[]): void {
        return this.log(3, args);
    }
}
