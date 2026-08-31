import type { AppContext } from "../../types";

/** Hono HTTP contexts carry a Request signal; internal worker contexts do not. */
export function readVideoOrchestratorRequestSignal(
  c: AppContext,
): AbortSignal | undefined {
  const signal = (
    c as unknown as { req?: { raw?: { signal?: unknown } } }
  ).req?.raw?.signal;
  if (
    signal &&
    typeof signal === "object" &&
    typeof (signal as { aborted?: unknown }).aborted === "boolean" &&
    typeof (signal as { addEventListener?: unknown }).addEventListener === "function"
  ) {
    return signal as AbortSignal;
  }
  return undefined;
}
