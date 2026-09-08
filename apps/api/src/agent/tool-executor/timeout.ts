export class ToolTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`tool timed out after ${timeoutMs}ms`);
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(ms)), ms);
  });
  return Promise.race([promise.then((v) => { clearTimeout(timer); return v; }, (e) => { clearTimeout(timer); throw e; }), timeout]);
}
