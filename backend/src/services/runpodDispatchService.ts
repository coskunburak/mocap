import { config } from "../config";

type RunPodDispatchResult =
  | { submitted: false; reason: "disabled" }
  | { submitted: true; requestId?: string; status?: string };

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function truncateBody(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function stringFromRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

export class RunPodDispatchService {
  async dispatchJob(jobId: string): Promise<RunPodDispatchResult> {
    if (!config.runpod.dispatchEnabled) {
      return { submitted: false, reason: "disabled" };
    }
    if (!config.runpod.endpointId || !config.runpod.apiKey) {
      throw new Error(
        "RUNPOD_DISPATCH_ENABLED is true but RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY is missing.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.runpod.requestTimeoutMs,
    );

    try {
      const response = await fetch(
        `${config.runpod.apiBaseUrl}/${encodeURIComponent(config.runpod.endpointId)}/run`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.runpod.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: {
              jobId,
              timeoutSeconds: config.runpod.jobTimeoutSeconds,
            },
          }),
          signal: controller.signal,
        },
      );
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }

      if (!response.ok) {
        const detail = body ? JSON.stringify(body).slice(0, 500) : truncateBody(text);
        throw new Error(`RunPod dispatch failed with HTTP ${response.status}: ${detail}`);
      }

      return {
        submitted: true,
        requestId:
          stringFromRecord(body, "id") ??
          stringFromRecord(body, "requestId") ??
          stringFromRecord(body, "jobId"),
        status: stringFromRecord(body, "status"),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `RunPod dispatch timed out after ${config.runpod.requestTimeoutMs}ms`,
        );
      }
      throw new Error(safeErrorMessage(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}
