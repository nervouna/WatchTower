export interface RetryOptions {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ExternalJsonResult<T> {
  data: T;
  requestId: string | null;
  attempts: number;
  durationMs: number;
}

export class ExternalApiError extends Error {
  constructor(
    readonly code: string,
    readonly attempts: number,
    readonly status: number | null,
    readonly requestId: string | null,
  ) {
    super(code);
    this.name = "ExternalApiError";
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function retryDelay(response: Response | null, attempt: number, random: () => number): number {
  const retryAfter = response?.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.min(30_000, Math.max(0, dateDelay));
  }
  return Math.min(30_000, 1000 * 2 ** (attempt - 1) + Math.floor(random() * 250));
}

export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<ExternalJsonResult<T>> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const requestedAttempts = options.maxAttempts ?? 3;
  const maxAttempts = Number.isFinite(requestedAttempts) && requestedAttempts >= 1
    ? Math.floor(requestedAttempts)
    : 3;
  const started = Date.now();
  let lastStatus: number | null = null;
  let lastRequestId: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort("timeout");
    }, options.timeoutMs ?? 30_000);
    let response: Response | null = null;
    try {
      response = await fetcher(input, { ...init, signal: controller.signal });
      lastStatus = response.status;
      lastRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      if (response.ok) {
        const data: unknown = await response.json();
        return { data: data as T, requestId: lastRequestId, attempts: attempt, durationMs: Date.now() - started };
      }
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt === maxAttempts) {
        throw new ExternalApiError(`HTTP_${String(response.status)}`, attempt, response.status, lastRequestId);
      }
    } catch (error) {
      if (error instanceof ExternalApiError) throw error;
      if (attempt === maxAttempts) {
        const code = controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR";
        throw new ExternalApiError(code, attempt, lastStatus, lastRequestId);
      }
    } finally {
      clearTimeout(timeout);
    }
    await sleep(retryDelay(response, attempt, random));
  }
  throw new ExternalApiError("NETWORK_ERROR", maxAttempts, lastStatus, lastRequestId);
}
