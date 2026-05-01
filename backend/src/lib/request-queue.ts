export type QueueStats = {
  activeCount: number;
  queuedCount: number;
  totalPending: number;
};

type Task = {
  run: () => void;
  reject: (reason?: unknown) => void;
};

export class RequestQueue {
  private readonly concurrency: number;
  private readonly maxQueueSize: number;
  private activeCount = 0;
  private queue: Task[] = [];
  private activeTasks = new Set<Task>();

  constructor(concurrency = 2, maxQueueSize = 100) {
    this.concurrency = Math.max(1, concurrency);
    this.maxQueueSize = Math.max(1, maxQueueSize);
  }

  add<T>(fn: () => Promise<T>): Promise<T> {
    const totalPending = this.activeCount + this.queue.length;
    if (totalPending >= this.maxQueueSize) {
      return Promise.reject(new Error('Request queue is full'));
    }

    return new Promise<T>((resolve, reject) => {
      const task: Task = {
        run: () => {
          fn().then(resolve, reject).finally(() => {
            this.activeTasks.delete(task);
            this.activeCount -= 1;
            this.pump();
          });
        },
        reject,
      };

      this.queue.push(task);
      this.pump();
    });
  }

  getStats(): QueueStats {
    return {
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      totalPending: this.activeCount + this.queue.length,
    };
  }

  clear(): void {
    for (const task of this.queue.splice(0)) {
      task.reject(new Error('Request queue was cleared'));
    }

    for (const task of this.activeTasks) {
      task.reject(new Error('Request queue was cleared'));
    }
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.activeCount += 1;
      this.activeTasks.add(task);
      task.run();
    }
  }
}
