import type { ApiResponse } from "./types";

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ??
  "/api/v1";

function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/api/")) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const started = performance.now();
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(resolveUrl(path), init);
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      payload,
      durationMs: Math.round(performance.now() - started),
      method,
      path,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: "Network error",
      payload: {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message:
            "The API could not be reached. Make sure the FastAPI server is running on port 8000.",
          detail: String(error),
        },
        meta: null,
      },
      durationMs: Math.round(performance.now() - started),
      method,
      path,
    };
  }
}

export function queryString(
  values: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
