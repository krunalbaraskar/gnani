export async function waitFor(
  cond: () => boolean,
  timeoutMs = 5000,
  what = 'condition',
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
