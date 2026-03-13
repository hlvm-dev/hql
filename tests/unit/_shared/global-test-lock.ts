let lastLock: Promise<void> = Promise.resolve();

export async function withGlobalTestLock<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const previous = lastLock;
  let release!: () => void;
  lastLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
