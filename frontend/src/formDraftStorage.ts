import type { FormDraft } from "./types";

const STORAGE_KEY = "nutri-ai:new-form-draft";

export type BuilderStep = "details" | "sections";

interface StoredFormDraft {
  draft: FormDraft;
  step: BuilderStep;
  savedAt: number;
}

function hasDraft(value: unknown): value is StoredFormDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredFormDraft>;
  return Boolean(
    candidate.draft &&
      typeof candidate.draft === "object" &&
      Array.isArray(candidate.draft.sections) &&
      Array.isArray(candidate.draft.unsectionedFields) &&
      Array.isArray(candidate.draft.Buttons),
  );
}

export function loadStoredFormDraft(): StoredFormDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!hasDraft(parsed)) return null;
    return {
      draft: parsed.draft,
      step: parsed.step === "sections" ? "sections" : "details",
      savedAt:
        typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveStoredFormDraft(
  draft: FormDraft,
  step: BuilderStep,
): void {
  try {
    const payload: StoredFormDraft = { draft, step, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable (private mode, quota). Draft persistence is
    // best-effort and should never break the builder.
  }
}

export function clearStoredFormDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
