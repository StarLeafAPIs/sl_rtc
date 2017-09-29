export interface VolumeMeter {
    start: (stream: MediaStream) => void;
    stop: () => void;
    testMicrophone: (btn: HTMLButtonElement, audio: HTMLAudioElement) => void;
}

export const enum VolState {
    SILENT,
    OK,
    LOUD
}

export function makeVolumeMeter(
    audio_ctx: AudioContext,
    canvas: HTMLCanvasElement,
    onChange?: (state: VolState) => void
): VolumeMeter {
    let analyser: AnalyserNode | null = null;
    let ticks = 0;
    let vol_state = VolState.OK;

    let { canvas_ctx, container } = (() => {
        let ctx = canvas.getContext('2d');
        let container = canvas.parentNode as HTMLElement;
        if (!ctx || !container) {
            throw 'Error creating canvas context';
        }
        return { canvas_ctx: ctx, container: container };
    })();

    let width = 0;
    let height = 0;
    let draw_visual = -1;
    let test_dest: any = null;

    let delay: DelayNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let buffer_length = 0;
    let data_array: Uint8Array;
    let render = false; //only render half the frames, 60fps is too much

    const fft_size = 1024;

    function checkVolume(): VolState {
        let silent = true;
        let avg = 0;
        for (let i = 0; i < data_array.length - 5; i++) {
            avg += data_array[i];
            if (avg != 0) {
                silent = false;
            }
            if (i >= 5) {
                avg -= data_array[i - 5];
            }
            if (avg / 5 > 235) {
                return VolState.LOUD;
            }
        }
        return silent ? VolState.SILENT : VolState.OK;
    }

    function draw() {
        if (!analyser) {
            return;
        }
        draw_visual = requestAnimationFrame(draw);
        if (!render) {
            render = true;
            return;
        } else {
            render = false;
        }

        analyser.getByteFrequencyData(data_array);
        let WIDTH = container.clientWidth;
        let HEIGHT = container.clientHeight;

        if (width != WIDTH || height != HEIGHT) {
            width = WIDTH;
            height = HEIGHT;
            canvas.setAttribute('width', String(WIDTH));
            canvas.setAttribute('height', String(HEIGHT));
        }
        //repaint background
        canvas_ctx.clearRect(0, 0, WIDTH, HEIGHT);
        canvas_ctx.fillStyle = 'rgb(255, 255, 255)';
        canvas_ctx.fillRect(0, 0, WIDTH, HEIGHT);
        // ignore the last half of the points, we don't get much of the higher frequencies.
        let num_points = Math.floor(buffer_length / 6);
        let spacing = WIDTH / num_points;
        let gradient = canvas_ctx.createLinearGradient(0, 0, 0, HEIGHT);
        let vs = checkVolume();
        if (vs !== vol_state) {
            vol_state = vs;
            if (onChange) onChange(vs);
        }

        if (vol_state === VolState.SILENT) {
            return;
        } else if (vol_state === VolState.LOUD) {
            gradient.addColorStop(0, 'rgba(202, 1, 85, 0.8)');
            gradient.addColorStop(1, 'rgba(202, 1, 85, 0.2)');
        } else {
            gradient.addColorStop(0, 'rgba(67, 164, 22, 0.3)');
            gradient.addColorStop(1, 'rgba(1, 222, 197, 0.6)');
        }
        canvas_ctx.fillStyle = gradient;
        for (let k = 0; k < 3; k++) {
            let offset = k * num_points;
            canvas_ctx.beginPath();
            canvas_ctx.moveTo(0, HEIGHT);
            for (let i = 0; i < num_points; i++) {
                let height = data_array[i + offset] / 256.0 * HEIGHT;
                canvas_ctx.lineTo(i * spacing, HEIGHT - height);
            }
            canvas_ctx.lineTo(num_points * spacing, HEIGHT);
            canvas_ctx.closePath();
            canvas_ctx.fill();
        }
    }

    let start = function(stream: MediaStream) {
        vol_state = VolState.OK;
        ticks = 0;
        analyser = audio_ctx.createAnalyser();
        analyser.fftSize = fft_size;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -30;
        analyser.smoothingTimeConstant = 0.85;
        source = audio_ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        buffer_length = analyser.frequencyBinCount;
        data_array = new Uint8Array(buffer_length);
        draw();
    };

    let stop = function() {
        window.cancelAnimationFrame(draw_visual);
        source = null;
        analyser = null;
    };

    let testMicrophone = (button: HTMLButtonElement, output: HTMLAudioElement) => {
        let ctx = audio_ctx as any;
        if (ctx && ctx.createMediaStreamDestination && source) {
            button.disabled = true;
            if (!delay) {
                delay = audio_ctx.createDelay(1.0);
                delay.delayTime.value = 1.0;
            }
            test_dest = ctx.createMediaStreamDestination();
            source.connect(delay);
            delay.connect(test_dest);
            output.srcObject = test_dest.stream;
            output.play();
            SLUI.messageBox(Dictionary['test_settings'], Dictionary['test_settings_detail'], {
                ok: () => {
                    if (source && delay && analyser) {
                        source.disconnect(delay);
                        source.connect(analyser);
                        test_dest = null;
                        button.disabled = false;
                        delay.disconnect(test_dest);
                    }
                }
            });
        }
    };
    return {
        start: start,
        stop: stop,
        testMicrophone: testMicrophone
    };
}
