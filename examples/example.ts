import {
    createCall,
    SlCall,
    CallEndReason,
    detectedBrowser,
    detectedVersion,
    VolumeMeter,
    Logger
} from '../lib/index';

window.onload = function() {
    let log_div = document.getElementById('log_div') as HTMLDivElement;
    let logger = new Logger(
        'SL',
        msg => {
            let line = document.createElement('div');
            line.textContent = msg;
            log_div.appendChild(line);
        },
        true
    );
    logger.info('window loaded, browser = ', detectedBrowser, detectedVersion);

    let local_video = document.getElementById('local_video') as HTMLVideoElement;
    let remote_video = document.getElementById('remote_video') as HTMLVideoElement;
    let remote_pc_video = document.getElementById('remote_pc_video') as HTMLVideoElement;
    let canvas = document.getElementById('vu_meter') as HTMLCanvasElement;
    let audio_ctx: AudioContext | undefined;
    if (typeof AudioContext !== 'undefined') {
        audio_ctx = new AudioContext();
    } else if (typeof (window as any).webkitAudioContext !== 'undefined') {
        audio_ctx = new (window as any).webkitAudioContext();
    } else {
        logger.warn('No audio context available, not showing vu-meter');
    }

    let local_stream: MediaStream;

    navigator.mediaDevices
        .getUserMedia({
            audio: true,
            video: {
                width: {
                    ideal: 1280,
                    max: 1280
                },
                height: {
                    ideal: 720,
                    max: 720
                },
                frameRate: {
                    ideal: 30,
                    max: 30
                }
            }
        })
        .then(stream => {
            local_stream = stream;
            local_video.srcObject = stream;
            logger.info('Got local stream', local_stream);
            local_video.play();
            if (audio_ctx) {
                let vu = VolumeMeter(audio_ctx, canvas);
                vu.start(stream);
            }
        })
        .catch(error => {
            logger.error('GUM request failed: ', error);
        });

    let start_call_button = document.getElementById('start_call') as HTMLButtonElement;
    let end_call_button = document.getElementById('end_call') as HTMLButtonElement;
    start_call_button.addEventListener('click', () => {
        let target = (document.getElementById('target') as HTMLInputElement).value;
        let cloud_select = document.getElementById('cloud_select') as HTMLSelectElement;
        let cloud_addr = cloud_select.options[cloud_select.selectedIndex].value;
        start_call_button.style.display = 'none';
        createCall(target, 'Example WebRTC client', logger, cloud_addr)
            .then((call: SlCall) => {
                call.on('add_stream', (remote_stream: MediaStream) => {
                    logger.debug('SlCall::addstream', remote_stream);
                    if (remote_stream.id == 'sl-video-stream') {
                        remote_video.srcObject = remote_stream;
                    } else if (remote_stream.id == 'sl-pc-stream') {
                        remote_pc_video.srcObject = remote_stream;
                    }
                });
                call.on('ringing', () => {
                    logger.debug('SlCall::ringing');
                    end_call_button.style.display = null;
                    end_call_button.onclick = () => {
                        call.hangup();
                    };
                });
                call.on('ended', (reason: CallEndReason) => {
                    logger.debug('SlCall::ended, reason: ', reason);
                    start_call_button.style.display = null;
                    end_call_button.style.display = 'none';
                });
                call.dial(local_stream);
            })
            .catch((error: any) => {
                logger.error('Failed to setup call: ', error);
                start_call_button.style.display = null;
            });
    });
};
