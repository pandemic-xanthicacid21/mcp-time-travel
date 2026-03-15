import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { AsyncWorkTracker } from './async-work-tracker.js';

describe('AsyncWorkTracker', () => {
  it('waits for tracked work to settle', async () => {
    const tracker = new AsyncWorkTracker();
    let completed = false;

    void tracker.track(
      delay(10).then(() => {
        completed = true;
      }),
    );

    await tracker.drain();

    expect(completed).toBe(true);
  });

  it('waits for work added while draining', async () => {
    const tracker = new AsyncWorkTracker();
    const completed: string[] = [];

    void tracker.track(
      delay(0).then(() => {
        completed.push('first');
        void tracker.track(
          delay(10).then(() => {
            completed.push('second');
          }),
        );
      }),
    );

    await tracker.drain();

    expect(completed).toEqual(['first', 'second']);
  });
});
