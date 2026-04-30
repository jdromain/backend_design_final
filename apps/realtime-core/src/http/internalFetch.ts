/**
 * Internal platform-api fetches with mandatory wall-clock budget.
 */

export type InternalFetchInit = RequestInit & {
  timeoutMs?: number;
};

export async function internalFetch(url: string, init: InternalFetchInit = {}): Promise<Response> {
  const { timeoutMs = 3_000, signal: userSignal, ...rest } = init;
  const ac = new AbortController();
  const t = setTimeout(() => {
    ac.abort(new Error(`Request timeout after ${timeoutMs}ms: ${url}`));
  }, timeoutMs);
  if (userSignal) {
    if (userSignal.aborted) {
      clearTimeout(t);
      throw userSignal.reason instanceof Error
        ? userSignal.reason
        : new Error(String(userSignal.reason ?? "aborted"));
    }
    userSignal.addEventListener("abort", () => ac.abort(userSignal.reason), { once: true });
  }
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}
