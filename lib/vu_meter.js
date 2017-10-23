"use strict";
/*
* Copyright (c) StarLeaf Limited, 2017
*/
Object.defineProperty(exports, "__esModule", { value: true });
function VolumeMeter(audio_ctx, canvas, onChange) {
    let analyser = null;
    let ticks = 0;
    let vol_state = 1 /* OK */;
    let canvas_ctx = canvas.getContext('2d');
    if (!canvas_ctx) {
        throw 'Error creating canvas context';
    }
    let width = 0;
    let height = 0;
    let draw_visual = -1;
    let source = null;
    let buffer_length = 0;
    let data_array;
    let render = false; //only render half the frames, 60fps is too much
    const fft_size = 1024;
    function checkVolume() {
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
                return 2 /* LOUD */;
            }
        }
        return silent ? 0 /* SILENT */ : 1 /* OK */;
    }
    function draw() {
        if (!analyser) {
            return;
        }
        draw_visual = requestAnimationFrame(draw);
        if (!render) {
            render = true;
            return;
        }
        else {
            render = false;
        }
        analyser.getByteFrequencyData(data_array);
        let WIDTH = canvas.clientWidth;
        let HEIGHT = canvas.clientHeight;
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
            if (onChange)
                onChange(vs);
        }
        if (vol_state === 0 /* SILENT */) {
            return;
        }
        else if (vol_state === 2 /* LOUD */) {
            gradient.addColorStop(0, 'rgba(202, 1, 85, 0.8)');
            gradient.addColorStop(1, 'rgba(202, 1, 85, 0.2)');
        }
        else {
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
    let start = function (stream) {
        vol_state = 1 /* OK */;
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
    let stop = function () {
        window.cancelAnimationFrame(draw_visual);
        source = null;
        analyser = null;
    };
    return {
        start: start,
        stop: stop
    };
}
exports.VolumeMeter = VolumeMeter;
