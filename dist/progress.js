"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Spinner = exports.ProgressBar = void 0;
/**
 * Simple progress bar for CLI output.
 * No external dependencies.
 */
class ProgressBar {
    total;
    current = 0;
    barWidth;
    label;
    startTime;
    constructor(total, label = "", barWidth = 30) {
        this.total = total;
        this.barWidth = barWidth;
        this.label = label;
        this.startTime = Date.now();
    }
    /** Update progress */
    tick(message) {
        this.current++;
        this.render(message);
    }
    /** Set progress to specific value */
    update(value, message) {
        this.current = value;
        this.render(message);
    }
    /** Complete the progress bar */
    complete(message) {
        this.current = this.total;
        this.render(message);
        process.stdout.write("\n");
    }
    render(message) {
        const pct = this.total > 0 ? this.current / this.total : 1;
        const filled = Math.round(this.barWidth * pct);
        const empty = this.barWidth - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        const percent = Math.round(pct * 100);
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const text = message || this.label;
        const line = `  ${bar} ${percent}% (${this.current}/${this.total}) ${elapsed}s ${text}`;
        // Clear line and write
        process.stdout.write(`\r${line.padEnd(80)}`);
    }
}
exports.ProgressBar = ProgressBar;
/**
 * Simple spinner for indeterminate operations.
 */
class Spinner {
    frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    frameIdx = 0;
    intervalId = null;
    message;
    constructor(message = "") {
        this.message = message;
    }
    start() {
        this.intervalId = setInterval(() => {
            const frame = this.frames[this.frameIdx % this.frames.length];
            process.stdout.write(`\r  ${frame} ${this.message}`);
            this.frameIdx++;
        }, 80);
    }
    updateMessage(message) {
        this.message = message;
    }
    stop(finalMessage) {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (finalMessage) {
            process.stdout.write(`\r  ✅ ${finalMessage}\n`);
        }
        else {
            process.stdout.write("\r" + " ".repeat(80) + "\r");
        }
    }
}
exports.Spinner = Spinner;
