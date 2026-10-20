export async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      if (task) results[index] = await task();
    }
  }

  const workers = Math.max(1, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
