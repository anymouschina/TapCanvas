import { AppError } from "../../middleware/error";
import type { NewApiModelDto } from "./new-api-models.service";

// Explicit product eligibility, independent of provider availability and media analysis.
const EXCLUDED_CHAT_MODEL_IDS = new Set(["doubao-seed-2-0-lite-260428"]);

export function isChatModelIdentifierAllowed(identifier: string): boolean {
  return !EXCLUDED_CHAT_MODEL_IDS.has(identifier.trim().toLowerCase());
}

export function isChatCatalogModelAllowed(
  model: Pick<NewApiModelDto, "modelName" | "requestModelKey" | "routingAliases">,
): boolean {
  return [model.modelName, model.requestModelKey, ...model.routingAliases]
    .every(isChatModelIdentifierAllowed);
}

export function assertChatModelAllowed(...identifiers: (string | null | undefined)[]): void {
  const excluded = identifiers.find((identifier) => identifier && !isChatModelIdentifierAllowed(identifier));
  if (excluded) {
    throw new AppError(`模型 ${excluded} 已从 AI 对话停用，请明确选择其他对话模型。`, {
      status: 400,
      code: "agents_chat_model_excluded",
      details: { model: excluded, upstreamRequestAttempted: false },
    });
  }
}
