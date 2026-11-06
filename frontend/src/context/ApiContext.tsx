import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { apiRequest } from "../api";
import type { ApiResponse } from "../types";

interface ApiContextValue {
  send: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<ApiResponse>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const send = useCallback(
    (method: string, path: string, body?: unknown) =>
      apiRequest(method, path, body),
    [],
  );

  const value = useMemo(() => ({ send }), [send]);

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) {
    throw new Error("useApi must be used inside ApiProvider");
  }
  return value;
}
