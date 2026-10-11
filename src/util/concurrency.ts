/**
 * Run `fn` over `items` with at most `limit` in flight at once. Workers pull
 * from a shared cursor, so faster tasks naturally pick up more work.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!, index);
    }
  };
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    worker,
  );
  await Promise.all(workers);
}
