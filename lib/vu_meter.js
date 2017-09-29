"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function VolumeMeter(audio_ctx, canvas, onChange) {
    var analyser = null;
    var ticks = 0;
    var vol_state = 1 /* OK */;
    var _a = (function () {
        var ctx = canvas.getContext('2d');
        var container = canvas.parentNode;
        if (!ctx || !container) {
            throw 'Error creating canvas context';
        }
        return { canvas_ctx: ctx, container: container };
    })(), canvas_ctx = _a.canvas_ctx, container = _a.container;
    var width = 0;
    var height = 0;
    var draw_visual = -1;
    var source = null;
    var buffer_length = 0;
    var data_array;
    var render = false; //only render half the frames, 60fps is too much
    var fft_size = 1024;
    function checkVolume() {
        var silent = true;
        var avg = 0;
        for (var i = 0; i < data_array.length - 5; i++) {
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
        var WIDTH = container.clientWidth;
        var HEIGHT = container.clientHeight;
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
        var num_points = Math.floor(buffer_length / 6);
        var spacing = WIDTH / num_points;
        var gradient = canvas_ctx.createLinearGradient(0, 0, 0, HEIGHT);
        var vs = checkVolume();
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
        for (var k = 0; k < 3; k++) {
            var offset = k * num_points;
            canvas_ctx.beginPath();
            canvas_ctx.moveTo(0, HEIGHT);
            for (var i = 0; i < num_points; i++) {
                var height_1 = data_array[i + offset] / 256.0 * HEIGHT;
                canvas_ctx.lineTo(i * spacing, HEIGHT - height_1);
            }
            canvas_ctx.lineTo(num_points * spacing, HEIGHT);
            canvas_ctx.closePath();
            canvas_ctx.fill();
        }
    }
    var start = function (stream) {
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
    var stop = function () {
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
