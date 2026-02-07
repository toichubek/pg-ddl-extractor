/**
 * Simple progress bar for CLI output.
 * No external dependencies.
 */
export class ProgressBar {
  private total: number;
  private current: number = 0;
  private barWidth: number;
  private label: string;
  private startTime: number;

  constructor(total: number, label: string = "", barWidth: number = 30) {
    this.total = total;
    this.barWidth = barWidth;
    this.label = label;
    this.startTime = Date.now();
  }

  /** Update progress */
  tick(message?: string): void {
    this.current++;
    this.render(message);
  }

  /** Set progress to specific value */
  update(value: number, message?: string): void {
    this.current = value;
    this.render(message);
  }

  /** Complete the progress bar */
  complete(message?: string): void {
    this.current = this.total;
    this.render(message);
    process.stdout.write("\n");
  }

  private render(message?: string): void {
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

/**
 * Simple spinner for indeterminate operations.
 */
export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private frameIdx = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private message: string;

  constructor(message: string = "") {
    this.message = message;
  }

  start(): void {
    this.intervalId = setInterval(() => {
      const frame = this.frames[this.frameIdx % this.frames.length];
      process.stdout.write(`\r  ${frame} ${this.message}`);
      this.frameIdx++;
    }, 80);
  }

  updateMessage(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (finalMessage) {
      process.stdout.write(`\r  ✅ ${finalMessage}\n`);
    } else {
      process.stdout.write("\r" + " ".repeat(80) + "\r");
    }
  }
}
