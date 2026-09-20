import { AppError } from "../../middleware/error";

/** Explicit invocation scope takes precedence over a saved chapter preference. */
export function resolveOnlyVideoNodes(explicit: unknown, chapterPreference: boolean | undefined): boolean {
  if (explicit === undefined) return chapterPreference === true;
  if (typeof explicit !== "boolean") {
    throw new AppError("onlyVideoNodes must be a boolean", { status: 400, code: "workflow_video_delivery_selection_invalid" });
  }
  return explicit;
}
