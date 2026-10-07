import { TaskReceiptAssetSchema, type TaskAssetDto, type TaskReceiptAsset, type TaskResultDto } from "./task.schemas";

/** Materialize historical evidence through the same hoster, independently of current task status/assets. */
export async function hostHistoricalVideoReceiptAssets(input: {
  result: TaskResultDto;
  stored?: TaskResultDto | null;
  hostAssets: (assets: TaskAssetDto[]) => Promise<TaskAssetDto[]>;
}): Promise<TaskResultDto> {
  const storedAssets = input.stored?.receiptAssets ?? [];
  const hostedBySource = new Map(storedAssets.filter((asset) => asset.sourceUrl)
    .map((asset) => [asset.sourceUrl!, asset]));
  const incoming = input.result.receiptAssets ?? [];
  const unhosted = incoming.filter((asset) => !hostedBySource.has(asset.sourceUrl ?? asset.url));
  if (unhosted.length > 0) {
    const hosted = await input.hostAssets(unhosted.map((asset) => ({ type: "video", url: asset.url })));
    if (hosted.length !== unhosted.length) throw new Error("historical_receipt_hosting_asset_count_mismatch");
    hosted.forEach((asset, index) => {
      const source = unhosted[index];
      const sourceUrl = source.sourceUrl ?? source.url;
      hostedBySource.set(sourceUrl, TaskReceiptAssetSchema.parse({ ...asset, observedAt: source.observedAt, sourceUrl }));
    });
  }
  const merged = new Map<string, TaskReceiptAsset>(storedAssets.filter((asset) => asset.sourceUrl)
    .map((asset) => [asset.sourceUrl!, asset]));
  for (const asset of incoming) {
    const sourceUrl = asset.sourceUrl ?? asset.url;
    const hosted = hostedBySource.get(sourceUrl);
    if (!hosted) throw new Error("historical_receipt_hosting_result_missing");
    merged.set(sourceUrl, hosted);
  }
  return incoming.length > 0 || storedAssets.length > 0
    ? { ...input.result, receiptAssets: [...merged.values()] } : input.result;
}
