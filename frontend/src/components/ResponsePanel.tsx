import type { ApiResponse } from "../types";
import { pretty } from "../utils";
import { HttpBadge } from "./StatusBadge";

export function ResponsePanel({
  response,
  title = "Response",
  emptyText = "Send a request to see the response here.",
}: {
  response: ApiResponse | null;
  title?: string;
  emptyText?: string;
}) {
  if (!response) {
    return (
      <div className="response-panel response-empty">
        <p className="small muted">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="response-panel">
      <div className="response-head">
        <div className="response-title">
          <span className="mono method-tag">{response.method}</span>
          <code>{response.path}</code>
        </div>
        <div className="response-meta">
          <HttpBadge status={response.status} />
          <span>{response.durationMs} ms</span>
          <span>{title}</span>
        </div>
      </div>
      <pre className="json-box">{pretty(response.payload) || "No response body."}</pre>
    </div>
  );
}
