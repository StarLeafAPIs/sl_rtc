import { createCall, SlCall } from '../lib/call/interface';
import { detectedBrowser } from '../lib/sl';
import { VolumeMeter } from '../lib/vu_meter';

window.onload = function() {
    let log_ = (...args: any[]) => {
        console.log(...args);
    };
    log_('window loaded, browser = ', detectedBrowser);

    let local_video = document.getElementById('local_video') as HTMLVideoElement;
    let remote_video = document.getElementById('remote_video') as HTMLVideoElement;
    let canvas = document.getElementById('vu_meter') as HTMLCanvasElement;
    let audio_ctx = new AudioContext();

    let local_stream: MediaStream;
    const meeting_id = '7079230';


    let logger = {
        debug: log_,
        info: log_,
        warn: log_,
        error: log_,
        sub: (prefix: string) => {
            return logger;
        }
    };

    navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .then(stream => {
            local_stream = stream;
            local_video.srcObject = stream;
            log_('Got local stream', local_stream);
            local_video.play();
            let vu = VolumeMeter(audio_ctx, canvas);
            vu.start(stream);
        })
        .catch(error => {
            console.log('GUM request failed: ', error);
        });

    let call_button = document.getElementById('start_call') as HTMLButtonElement;
    call_button.addEventListener('click', () => {
        call_button.style.display = 'none';
        createCall(
            meeting_id,
            'Example WebRTC client',
            logger,
            'portal.starleaf.com'
        ).then((call: SlCall) => {
            call.on('addstream', (remote_stream: MediaStream) => {
                log_('SlCall::addstream', remote_stream);
                remote_video.srcObject = remote_stream;
            });
            call.on('ended', () => {
                log_('SlCall::ended');
                call_button.style.display = null;
            })
            call.dial({
                mediaStream: local_stream
            });
        })
        .catch((error) => {
            log_('Failed to setup call: ', error);
            call_button.style.display = null;
        })
    })
};
