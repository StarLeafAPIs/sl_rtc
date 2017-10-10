import { createCall, SlCall, CallEndReason } from '../lib/index';
import { detectedBrowser } from '../lib/index';
import { VolumeMeter } from '../lib/index';
import { Logger } from '../lib/index';
import { detectedVersion } from '../lib/sl';

window.onload = function() {
    let logger = new Logger('SL', () => {}, true);
    logger.info('window loaded, browser = ', detectedBrowser, detectedVersion);

    let local_video = document.getElementById('local_video') as HTMLVideoElement;
    let remote_video = document.getElementById('remote_video') as HTMLVideoElement;
    let canvas = document.getElementById('vu_meter') as HTMLCanvasElement;
    let audio_ctx = new AudioContext();

    let local_stream: MediaStream;
    const meeting_id = '7079230';

    navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .then(stream => {
            local_stream = stream;
            local_video.srcObject = stream;
            logger.info('Got local stream', local_stream);
            local_video.play();
            let vu = VolumeMeter(audio_ctx, canvas);
            vu.start(stream);
        })
        .catch(error => {
            logger.error('GUM request failed: ', error);
        });

    let start_call_button = document.getElementById('start_call') as HTMLButtonElement;
    let end_call_button = document.getElementById('end_call') as HTMLButtonElement;
    start_call_button.addEventListener('click', () => {
        start_call_button.style.display = 'none';
        createCall(
            meeting_id,
            'Example WebRTC client',
            logger
        ).then((call: SlCall) => {
            call.on('add_stream', (remote_stream: MediaStream) => {
                logger.debug('SlCall::addstream', remote_stream);
                remote_video.srcObject = remote_stream;
            });
            call.on('ringing', () => {
                logger.debug('SlCall::ringing');
                end_call_button.style.display = null;
                end_call_button.onclick = () => {
                    call.hangup();
                }
            })
            call.on('ended', (reason: CallEndReason) => {
                logger.debug('SlCall::ended', reason);
                start_call_button.style.display = null;
                end_call_button.style.display = 'none';
            })
            call.dial(local_stream);
        })
        .catch((error: any) => {
            logger.error('Failed to setup call: ', error);
            start_call_button.style.display = null;
        });
    })
};
