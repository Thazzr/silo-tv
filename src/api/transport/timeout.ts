/** How long an API request may take before it counts as unreachable. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Runs `send` with a signal that fires after `ms`, or when the caller's own signal fires. A
 * timeout rejects with a TypeError, the same shape as a browser network failure, so callers handle
 * one kind of "unreachable" (and a timeout never reads as a refused token). The caller's abort
 * rejects with an AbortError. Built on AbortController and setTimeout because AbortSignal.timeout
 * and AbortSignal.any do not exist in Chromium 79.
 */
export function withTimeout<T>(
  callerSignal: AbortSignal | null | undefined,
  send: (signal: AbortSignal) => Promise<T>,
  ms: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let onCallerAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settled = new Promise<never>((_, reject) => {
    const fail = () =>
      reject(
        timedOut
          ? new TypeError(`Network request failed: no answer within ${ms / 1000} s`)
          : new DOMException('The request was aborted', 'AbortError'),
      );
    // Also covers a transport that cannot cancel its call (the service): the race still ends.
    controller.signal.addEventListener('abort', fail);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else {
        onCallerAbort = () => controller.abort();
        callerSignal.addEventListener('abort', onCallerAbort);
      }
    }
  });

  const cleanup = () => {
    clearTimeout(timer);
    if (callerSignal && onCallerAbort) callerSignal.removeEventListener('abort', onCallerAbort);
  };
  return Promise.race([send(controller.signal), settled]).finally(cleanup);
}
