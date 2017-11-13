# StarLeaf WebRTC

## Intro

StarLeaf enables WebRTC calls to any user or meeting on StarLeaf.
We're publishing a JavaScript library to allow you to add StarLeaf
video calling to your own apps or websites. The library is written in
typescript, and published as a node module. The same library is used to produce
StarLeaf's WebRTC webpage.
An [Example web page](https://starleafapis.github.io/sl_rtc/examples/web/index) can be found here.

## Installation
`npm install sl_rtc`

Requires node >= v8.1.4, npm >= 5.0.3

## API

See the [web example](https://starleafapis.github.io/sl_rtc/examples/web/index) for a simple website using this library.
See the [electron example](/examples/electron) for a simple electron app using this library.

The main exports are defined in [index.ts](/src/index.ts). The compiled [index.js](/lib/index.js)
is the entry point for the npm package.

The compiled javascript and typescript declaration files live in [lib/](/lib/)
The source code typescript lives in [src/](/src/).

All the example code here is in typescript.
### Creating a call
```ts
import { createCall, SlCall } from 'sl_rtc';

function myStarLeafCall(local_stream: MediaStream) {
    createCall('demo@starleaf.com', 'My Name')
        .then((call: SlCall) => {
            // add event handlers
            call.on('addstream', (remote_stream) => {
                let vid = document.getElementById('remote_video') as HTMLVideoElement;
                vid.srcObject = remote_stream;
                vid.play();
            })`
            // Start the call`
            call.dial(local_stream);
        });
}

navigator.mediaDevices
    .getUserMedia({
        audio: true,
        video: true
    })
    .then((local_stream: MediaStream) => {
        myStarLeafCall(local_stream);
    });
```

## createCall
```ts
function createCall(target: string, display_name: string, logger?: ILogger, api_hostname?: string): Promise<SlCall>
```

`target` is a valid StarLeaf video address
This can be:
1. The email address of a StarLeaf user or meeting room e.g. `'demo@starleaf.com'`
2. The seven digit meeting ID of a meeting scheduled on StarLeaf e.g. `'7311392'`

Please refer to the [StarLeaf Cloud API Guide](https://support.starleaf.com/integrating/cloud-api/using-the-starleaf-cloud-api/)
where you can find out how to find users and schedule meetings programmatically.

`display_name` is this client's indentifier, and will be seen by the other StarLeaf users.

`logger` is optional. See the definition of `ILogger` in [logger.ts](/src/logger.ts) if you
wish to provide your own logger. The default is no logging.

`api_hostname` lets you specify the hostname of the StarLeaf api service to connect to. Defaults to
`api.starleaf.com`. Beta testing use only.

`createCall` asks StarLeaf to validate the target address, and returns a Promise that
resolves to an `SlCall` object. When the promise resolves, you'll need to add a few event
handlers to it, and then use the `dial` method to begin the call.

## SlCall
See [call/interface.ts](/src/call/interface.ts) for the full definition of the `SlCall` interface.
`createCall` returns an object implementing this interface.

### SlCall::dial(local_stream)
This method starts the call. It takes a [MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream). This media stream
* MUST have 1 audio track
* MAY have 1 video track.

The video track must be:
* At most 30 frames per second
* At most 1280 pixels wide
* At most 720 pixels high

See [getUserMedia API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
for details on setting up these streams.
```ts
let stream: MediaStream;
// get a MediaStream using the getUserMedia api
call.dial(stream);
```

### SlCall::on(event, handler)
Use this method to add event handlers to the call object. The event types are detailed below.
See [call/interface.ts](/src/call/interface.ts) for the full definitions.
#### ringing
Fired once the SIP user agent is connected. The call negotiation has begun.
```ts
call.on('ringing', () => {
    // playing ringing noise or show ringing effect
});
```
#### in_call
Fired when the call connects and audio/video begins.
```ts
call.on('in_call', () => {
    // hide ringing notification
});
```

#### add_stream
Fired when a remote [MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream)
is added.
StarLeaf calls may add two remote streams.

The first has the id `sl-video-stream`. This will have 1 audio track, and 1 video track.

The second has the id `sl-pc-stream`. This will have 1 video track only. This will be added if the remote
side starts sharing their pc screen.
```ts
call.on('add_stream', (stream: MediaStream) => {
    if (stream.id === 'sl-video-stream') {
        let vid = document.getElementById('remote_video') as HTMLVideoElement;
        vid.srcOject = stream;
        vid.play();
    } else if (stream.id === 'sl-pc-stream') {
        let vid = document.getElementById('remote_screenshare') as HTMLVideoElement;
        vid.srcOject = stream;
        vid.play();
    }
});
```

#### remove_stream
Fired when a remote MediaStream is removed.
```ts
call.on('remove_stream', (stream: MediaStream) {
    if (stream.id === 'sl-pc-stream') {
        // hide remote pc video
    }
})
```

#### ending
Fired when the call is ending. The process of negotating the end of the call can take a few seconds,
this event is fired when that process starts.
```ts
call.on('ending', () => {
    // hide videos, display message
});
```

#### ended
Fired when the call has ended. The callback receives a value from CallEndReason enum
```ts
import { CallEndReason } from 'sl_rtc';
call.on('ended', (reason: CallEndReason) => {
    if (reason === CallEndReason.BUSY) {
        // please try again later
    }
});
```

#### renegotiated
SIP requires a re-invite SIP message to be sent when [ICE](https://en.wikipedia.org/wiki/Interactive_Connectivity_Establishment)
has completed. This event is fired after that process is complete.
After this event has fired, you may add a secondary video stream to the call - but not before!
```ts
let allow_start_screenshare = false;
call.on('renegotiated', () => {
    allow_start_screenshare = true;
});
```

#### pc_state
Fired when the state of the PC stream changes. In StarLeaf video calls, only 1 participant can share
their screen at a time. If another participant shares their screen, the right to screen share is "stolen" by them.
This event can help you keep track of whether this client, or a remote participant, is sharing their screen.
```ts
import { PCState } from 'sl_rtc';
call.on('pc_state', (state: PCState) => {
    if (state === PCState.SEND) {
        // this client is sending a screen share stream
    } else if (state === PCState.RECV) {
        // this client is receiving a screen share stream
    } else if (state === DISABLED) {
        // no-one is currently sharing a screen.
    }
})
```

#### audio_only
Fired if the call drops down to an audio only call. This can happen if the StarLeaf user being called does
not have any video equipment. In this state, no video will be sent or received.
```ts
call.on('audio_only', (audio_only: boolean) {
    if (audio_only) {
        // show appropriate display, hide <video> elements
    } else {
        // show <video> elements
    }
})
```

### SlCall::hangup
Ends the call. Will terminate the call with `CallEndReason.USER_BYE`
```
call.hangup();
```

### SlCall::mute
Mute or unmute the local audio/video stream. Muting the video stream
means sending a blank image, instead of the users camera.
```ts
// mute the audio stream, unmute the video stream
call.mute({
    audio: true,
    video: false
});
```

### SlCall::isMuted
Convenience method, returns the local mute state.
```ts
if (call.isMuted().video) {
    // users camera is currently muted.
}
if (call.isMuted().audio) {
    // users mic is currently muted.
}
```

### SlCall::addPCStream
Add a MediaStream containing one video track only to this call. StarLeaf will treat this
as the user sharing their screen, though you are free to pass any secondary video stream
you like in.
This video stream must be
* At most 12 frames per second
* At most 1920 pixels wide
* At most 1088 pixels high
```ts
let pc_stream_handle: MediaStream;
navigator.mediaDevices.getUserMedia({
    video: {
        mediaSource: 'screen',
        frameRate: { min: 2, ideal: 12, max: 12 },
        width: { max: 1920 },
        height: { max: 1088 }
    }
}).then((pc_stream: MediaStream) => {
    pc_stream_handle = pc_stream;
    // display the stream, so the user knows what they're sharing.
    let local_pc_vid = document.getElementById('local_pc') as HTMLVideoElement;
    local_pc_vid.srcObject = pc_stream;
    local_pc_vid.play();
    // Add the PC stream to the call.
    call.addPCStream(pc_stream);
});
```

### SlCAll::removePCStream
Remove the PC local pc stream
```ts
call.removePCStream(pc_stream_handle);
```

### enum CallEndReason
* `USER_BYE` call.hangup() ended the call.
* `REMOTE_BYE` - the remote side ended the call normally.
* `BUSY` - the target is busy, perhaps already in a call.
* `NOT_FOUND` - target is offline at the moment.
* `UNAVAILABLE` - target is unavailable.
* `REJECTED` - Only occurs if dialing a StarLeaf user that does not have voice and video mail enabled. This user has declined to take your call.
* `CONNECTION_ERROR` - Signalling connection ended unexpectedly - e.g. internet disconnects.
* `CONNECTION_TIMEOUT` - Signalling connection never connected. User's firewall must allow TLS connections to *.call.sl on port 443.
* `CONNECTION_REFUSED` - WebSocket connection refused due to certificate error.
* `ICE_FAILURE` - ICE failed to find a valid media address. Should never occur on a chromium based browser, as we support fallback to TCP media on port 443. May occur on Firefox.
* `SIP_ERROR` - SIP negotiation resulted in an error. Contact StarLeaf support.
* `INTERNAL_ERROR` - Error in the StarLeaf cloud. Service may be offline.

### VolumeMeter
An animated volume meter. Pass it a canvas element, and it will render a pretty graph of the microphone levels.
The platform must support the [WebAudio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).
The canvas should be sized explicitly.
```html
<canvas id="vu_canvas" style="width: 100%; height: 200px"></canvas>
```
```ts
import { VolumeMeter, VolState } from 'sl_rtc';
let ctx = new AudioContext();
let canvas = document.getElementById('vu_canvas') as HTMLCanvasElement;

let vu_meter = VolumeMeter(ctx, canvas, (state: VolState) => {
    if (state == VolState.SILENT) {
        // warn user their mic is silent
    } else if (state == VolState.LOUD) {
        // The graph gets coloured red if the microphone is too loud,
        // but you could add your own warning here.
    } else if (state == VolState.OK) {
        // reset warnings
    }
});
// NOTE. does not require the new keyword. It is a function returning an object, not a class.

navigator.mediaDevices.getUserMedia({audio: true})
    .then((stream: MediaStream) => {
        vu_meter.start(stream);
    });
```

### Logger
Simple logger class. Takes a callback, which it calls with each processed log line.
The log lines are timestamped in UTC. You can pass any number of arguments,
which can be Objects, strings, or numbers. Object properties are logged on seperate lines, with the message indented.
```ts
let log_buffer: string[] = [];
let my_logger = new Logger(
    'RTC', // a module name to prefix the messages with
    (log_line: string) => { // provide a function to save the output
        log_buffer.push(log_line);
    },
    true // enable console logging
);
let my_sub_logger = my_logger.sub('CALL');
let target = 'demo@starleaf.com'
my_sub_logger.info('Dialing', target);

//output
// I 2017 Oct 6 13:36:34.325 RTC/CALL        Dialing: demo@starleaf.com\n

my_sub_logger.info('object', {
    hello: 'world'
})

// I 2017 Oct 6 13:36:34.333 RTC/CALL        object\n
// I 2017 Oct 6 13:36:34.333 RTC/CALL          hello: world\n
```

