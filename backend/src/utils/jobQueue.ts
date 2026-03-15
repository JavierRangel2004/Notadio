export class JobQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private readonly concurrency: number;

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    this.drain();
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      this.running++;
      const task = this.queue.shift()!;
      task().finally(() => {
        this.running--;
        this.drain();
      });
    }
  }
}
