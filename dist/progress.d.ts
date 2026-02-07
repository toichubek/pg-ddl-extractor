/**
 * Simple progress bar for CLI output.
 * No external dependencies.
 */
export declare class ProgressBar {
    private total;
    private current;
    private barWidth;
    private label;
    private startTime;
    constructor(total: number, label?: string, barWidth?: number);
    /** Update progress */
    tick(message?: string): void;
    /** Set progress to specific value */
    update(value: number, message?: string): void;
    /** Complete the progress bar */
    complete(message?: string): void;
    private render;
}
/**
 * Simple spinner for indeterminate operations.
 */
export declare class Spinner {
    private frames;
    private frameIdx;
    private intervalId;
    private message;
    constructor(message?: string);
    start(): void;
    updateMessage(message: string): void;
    stop(finalMessage?: string): void;
}
