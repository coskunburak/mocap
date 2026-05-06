export type ApiClientOptions = Readonly<{
  baseUrl: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
  tokenProvider?: () => string | undefined | Promise<string | undefined>;
}>;

export type ApiRequestOptions = Readonly<{
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  retryAttempts?: number;
}>;

export class ApiClientError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    status?: number;
    code?: string;
    requestId?: string;
    details?: unknown;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.status = input.status;
    this.code = input.code ?? "api_error";
    this.requestId = input.requestId;
    this.details = input.details;
    this.retryable = input.retryable ?? false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status: number | undefined, method: string) {
  if (method !== "GET") return false;
  return status == null || status === 408 || status === 429 || status >= 500;
}

function trimSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(private readonly options: ApiClientOptions) {
    this.baseUrl = trimSlash(options.baseUrl);
  }

  async request<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    const method = options?.method ?? "GET";
    const maxAttempts = Math.max(
      1,
      options?.retryAttempts ?? this.options.retryAttempts ?? 1,
    );
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.requestOnce<T>(path, { ...options, method });
      } catch (error) {
        lastError = error;
        const apiError =
          error instanceof ApiClientError
            ? error
            : new ApiClientError({
                message: error instanceof Error ? error.message : "Network request failed",
                code: "network_error",
                retryable: true,
              });

        if (
          attempt >= maxAttempts ||
          !apiError.retryable ||
          !shouldRetry(apiError.status, method)
        ) {
          throw apiError;
        }

        const backoff = this.options.retryBackoffMs ?? 400;
        await sleep(backoff * attempt);
      }
    }

    throw lastError;
  }

  private async requestOnce<T>(
    path: string,
    options: ApiRequestOptions & { method: string },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? this.options.timeoutMs ?? 20_000,
    );

    try {
      const token = await this.options.tokenProvider?.();
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = text.length ? tryParseJson(text) : undefined;
      if (!response.ok) {
        const errorPayload =
          payload && typeof payload === "object" && "error" in payload
            ? (payload as {
                error?: {
                  code?: string;
                  message?: string;
                  details?: unknown;
                  requestId?: string;
                };
              }).error
            : undefined;
        throw new ApiClientError({
          status: response.status,
          code: errorPayload?.code,
          message: errorPayload?.message ?? `API request failed: ${response.status}`,
          requestId: errorPayload?.requestId,
          details: errorPayload?.details,
          retryable: shouldRetry(response.status, options.method),
        });
      }

      return payload as T;
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"));
      throw new ApiClientError({
        code: aborted ? "request_timeout" : "network_error",
        message: aborted ? "Request timed out" : "Network request failed",
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiClientError({
      code: "invalid_json",
      message: "API returned invalid JSON",
      retryable: false,
    });
  }
}
