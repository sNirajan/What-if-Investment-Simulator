import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestQueue } from '../src/lib/request-queue.js';

describe('RequestQueue', () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue(2, 10);
  });

  it('executes tasks in order', async () => {
    const results: number[] = [];
    
    const fn1 = async () => { results.push(1); return 1; };
    const fn2 = async () => { results.push(2); return 2; };
    const fn3 = async () => { results.push(3); return 3; };

    const [r1, r2, r3] = await Promise.all([
      queue.add(fn1),
      queue.add(fn2),
      queue.add(fn3),
    ]);

    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(r3).toBe(3);
    expect(results).toContain(1);
    expect(results).toContain(2);
    expect(results).toContain(3);
  });

  it('respects concurrency limit', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const createTask = async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 10));
      currentConcurrent--;
    };

    const promises = Array.from({ length: 6 }, () => queue.add(createTask));
    await Promise.all(promises);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('rejects when queue is full', async () => {
    const fullQueue = new RequestQueue(1, 2); // Max 2 items    
    const slowFn = () => new Promise(resolve => setTimeout(resolve, 100));    
    // Add 2 tasks (will fill the queue)
    fullQueue.add(slowFn);
    fullQueue.add(slowFn);
    
    // Third should be rejected
    await expect(fullQueue.add(slowFn)).rejects.toThrow('Request queue is full');
  });

  it('propagates errors from tasks', async () => {
    const errorFn = () => Promise.reject(new Error('Task failed'));
    
    await expect(queue.add(errorFn)).rejects.toThrow('Task failed');
  });

  it('provides queue stats', async () => {
    const slowFn = () => new Promise(resolve => setTimeout(resolve, 50));    
    // Add 3 tasks with concurrency of 2
    const promises = [
      queue.add(slowFn),
      queue.add(slowFn),
      queue.add(slowFn),
    ];

    // Give it time to start processing
    await new Promise(resolve => setTimeout(resolve, 5));
    
    const stats = queue.getStats();
    expect(stats.activeCount).toBeGreaterThan(0);
    expect(stats.queuedCount).toBeGreaterThan(0);
    expect(stats.totalPending).toBeGreaterThan(0);

    await Promise.all(promises);
  });

  it('can clear the queue', async () => {
    const fn = vi.fn(() => Promise.resolve('result'));
    
    const p1 = queue.add(fn);
    const p2 = queue.add(fn);
    
    queue.clear();
    
    await expect(p1).rejects.toThrow('Request queue was cleared');
    await expect(p2).rejects.toThrow('Request queue was cleared');
  });
});
