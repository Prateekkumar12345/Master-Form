import type { ReactNode } from "react";

import { Icon } from "./Icon";

export function Notice({
  tone = "info",
  children,
  onDismiss,
}: {
  tone?: "success" | "error" | "info";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const icon = tone === "success" ? "check" : tone === "error" ? "alert" : "clock";
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size={17} />
      <div className="notice-content">{children}</div>
      {onDismiss ? (
        <button
          aria-label="Dismiss message"
          className="icon-button"
          type="button"
          onClick={onDismiss}
        >
          <Icon name="x" size={15} />
        </button>
      ) : null}
    </div>
  );
}
