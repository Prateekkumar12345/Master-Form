export function StatusBadge({
  status,
  deleted = false,
}: {
  status: string;
  deleted?: boolean;
}) {
  const normalized = status.toUpperCase();
  const tone = deleted
    ? "deleted"
    : normalized === "PUBLISHED"
      ? "published"
      : normalized === "DRAFT"
        ? "draft"
        : normalized === "ARCHIVED"
          ? "archived"
          : "neutral";
  const label = deleted
    ? "Deleted"
    : normalized === "DRAFT"
      ? "Draft"
      : normalized === "PUBLISHED"
        ? "Published"
        : normalized === "ARCHIVED"
          ? "Archived"
          : status || "Unknown";
  return <span className={`status-badge status-${tone}`}>{label}</span>;
}

export function HttpBadge({ status }: { status: number }) {
  const tone =
    status === 0
      ? "neutral"
      : status >= 200 && status < 300
        ? "published"
        : status >= 400 && status < 500
          ? "draft"
          : "danger";
  return (
    <span className={`status-badge status-${tone}`}>
      {status === 0 ? "No response" : `HTTP ${status}`}
    </span>
  );
}
