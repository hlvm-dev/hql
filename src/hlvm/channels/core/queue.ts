export interface SessionQueue {
  run<T>(sessionId: string, task: () => Promise<T>): Promise<T>;
}

export function createSessionQueue(): SessionQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    async run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(sessionId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      tails.set(sessionId, tail);

      await previous;
      try {
        return await task();
      } finally {
        release();
        if (tails.get(sessionId) === tail) {
          tails.delete(sessionId);
        }
      }
    },
  };
}
