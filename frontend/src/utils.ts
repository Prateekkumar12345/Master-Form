import type {
  ApiResponse,
  Coded,
  FormStatus,
  MasterForm,
  ValidationRules,
} from "./types";

export function codeOf(value: Coded): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return value.code ?? "";
}

const ACRONYMS = new Set(["API", "ID", "URL", "HTTP", "JSON", "UUID"]);

export function labelize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .split(" ")
    .map((word) =>
      ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word,
    )
    .join(" ");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortId(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function pretty(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function errorMessage(result: ApiResponse): string {
  const error = result.payload?.error;
  const detail = result.payload?.detail;
  const message = error?.message ?? error?.detail ?? detail?.message;

  if (typeof message === "string" && message.trim()) return message;

  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    const field = Array.isArray(first?.loc)
      ? first.loc.filter((part: unknown) => part !== "body").join(".")
      : "";
    const text = typeof first?.msg === "string" ? first.msg : "Invalid value.";
    return field ? `${field}: ${text}` : text;
  }

  if (typeof detail === "string" && detail.trim()) return detail;
  if (result.status === 0) {
    return "We couldn't reach the API. Check that the backend is running and try again.";
  }
  return `Something went wrong (HTTP ${result.status}). Please try again.`;
}

const RESPONSE_PATH_PREFIX = "response.";
const RESPONSE_PATH_PATTERN =
  /^(?:success|message|data|meta|error|detail)(?:\.[A-Za-z_$][\w$]*)*$/;

export function resolveResponseMessage(
  template: string | null | undefined,
  payload: unknown,
): string | null {
  const raw = template?.trim();
  if (!raw) return null;
  const value = raw.startsWith(RESPONSE_PATH_PREFIX)
    ? raw.slice(RESPONSE_PATH_PREFIX.length).trim()
    : raw;
  if (!value) return null;
  if (!RESPONSE_PATH_PATTERN.test(value)) return value;

  let current: unknown = payload;
  for (const part of value.split(".")) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === "string") return current.trim() || null;
  if (typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }
  return null;
}

export function makeCode(value: string, fallback: string): string {
  const code = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code || fallback;
}

export function uniqueCode(
  value: string,
  used: Set<string>,
  fallback: string,
): string {
  const base = makeCode(value, fallback);
  let code = base;
  let suffix = 2;
  while (used.has(code)) {
    code = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(code);
  return code;
}

export const STATUSES: FormStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

export const STATUS_TRANSITIONS: Record<FormStatus, FormStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export function canEditForm(form: MasterForm | null | undefined): boolean {
  return Boolean(
    form && !form.isDeleted && codeOf(form.status) === "DRAFT",
  );
}

export function transitionLabel(from: string, to: string): string {
  if (to === "PUBLISHED") return "Publish form";
  if (to === "ARCHIVED") return "Archive form";
  if (from === "PUBLISHED") return "Choose version to publish";
  if (from === "ARCHIVED") return "Reopen as draft";
  return "Return to draft";
}

export function transitionHint(from: string, to: string): string {
  if (to === "PUBLISHED") {
    return "Makes the active version available for use. No new version is created.";
  }
  if (to === "ARCHIVED") {
    if (from === "PUBLISHED") {
      return "Stops the form from being used. You can reopen it later.";
    }
    return "Stops the form from being used. You can reopen it later.";
  }
  if (from === "PUBLISHED") {
    return "Choose a saved draft version to publish. The form will remain published.";
  }
  if (from === "ARCHIVED") {
    return "Reopens the form for editing. No new version is created.";
  }
  return "Makes the form editable again. Editing will create a new version.";
}

export function validationSummary(
  validation: ValidationRules | { [key: string]: unknown } | null | undefined,
): string {
  if (!validation) return "";
  const entries = Object.entries(validation).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (!entries.length) return "";
  return entries
    .map(([key, value]) => `${labelize(key)}: ${String(value)}`)
    .join(" · ");
}
