import { z } from 'zod';
import { AppError } from '../../middleware/error';
import { readFirstImageResult } from './agents-tool-bridge.image-reference-ids';
import { parseVideoGenerationContract, type VideoGenerationContract, type VideoReferenceAudioPolicy } from './video-orchestrator.generation-contract';

export const PreparedCanvasMediaSubmissionArgsSchema = z.object({
  nodeId: z.string().trim().min(1),
  bookId: z.string().trim().min(1).optional(),
}).strict();

export function resolvePreparedVideoGenerationContract(node: Record<string, unknown>, outputs: readonly unknown[], referenceAudioPolicy: VideoReferenceAudioPolicy, explicitModelContract?: VideoGenerationContract): void {
  const data = record(node.data);
  if (!data) throw new AppError('Prepared video node data is missing', { status: 422, code: 'prepared_media_node_invalid' });
  const selectedModel = text(data.modelKey) || text(data.videoModel);
  const contracts = explicitModelContract ? [explicitModelContract] : data.generationContract !== undefined ? [data.generationContract] : outputs.flatMap((output) => {
    const artifacts = record(output)?.artifacts;
    return Array.isArray(artifacts) ? artifacts.flatMap((artifact) => {
      const entry = record(artifact);
      return entry?.type === 'tapcanvas.delivery-contract/v2' ? [record(entry.value)?.generationContract] : [];
    }) : [];
  });
  const validContracts = contracts.map((value) => {
    const contract = record(value);
    return parseVideoGenerationContract(contract && contract.referenceAudioPolicy === undefined
      ? { ...contract, referenceAudioPolicy } : contract);
  });
  if (validContracts.length === 0 || validContracts.some((contract) => !contract)
    || !selectedModel || validContracts.some((contract) => contract?.videoModel !== selectedModel)
    || new Set(validContracts.map((contract) => JSON.stringify(contract))).size !== 1) {
    throw new AppError('Prepared video has no unambiguous frozen generation contract for its selected model', {
      status: 422, code: 'prepared_media_generation_contract_missing',
      details: { nodeId: node.id, upstreamRequestAttempted: false },
    });
  }
  data.generationContract = validContracts[0];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** The caller supplies only an authorized canvas handle; paid inputs remain server-owned. */
export function resolvePreparedCanvasMediaSubmission(input: {
  args: unknown;
  graph: unknown;
  media: 'image' | 'video';
  authorizedBookId?: string;
}): { node: Record<string, unknown> } {
  const parsed = PreparedCanvasMediaSubmissionArgsSchema.safeParse(input.args);
  if (!parsed.success) throw new AppError('Prepared media submission requires only nodeId', {
    status: 400, code: 'prepared_media_submission_invalid', details: { issues: parsed.error.issues },
  });
  if (parsed.data.bookId && parsed.data.bookId !== text(input.authorizedBookId)) {
    throw new AppError('Prepared media book scope does not match the authorized canvas scope', {
      status: 409, code: 'prepared_media_book_scope_mismatch',
      details: { requestedBookId: parsed.data.bookId, authorizedBookId: text(input.authorizedBookId) || null },
    });
  }
  const graph = record(input.graph);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(record).filter((node): node is Record<string, unknown> => Boolean(node)) : [];
  const node = nodes.find((candidate) => candidate.id === parsed.data.nodeId);
  const data = record(node?.data);
  if (!node || !data) throw new AppError('Prepared media node not found on the authorized canvas', {
    status: 404, code: 'prepared_media_node_not_found',
  });
  const kindMatches = input.media === 'image'
    ? data.kind === 'image' || data.kind === 'imageEdit'
    : data.kind === 'video';
  const hasAsset = [data.imageUrl, data.videoUrl, data.assetUrl, data.mediaUrl].some((value) => Boolean(text(value)))
    || [data.imageResults, data.videoResults].some((value) => Array.isArray(value) && value.length > 0);
  if (!kindMatches || data.workflowPreparedOnly !== true || data.status !== 'idle'
    || !text(data.workflowEffectId) || !text(data.workflowExecutionFamilyId)
    || data.workflowSubmissionState || data.taskId || data.imageTaskId || data.videoTaskId || hasAsset) {
    throw new AppError('Canvas media is not an unsubmitted prepared node; reconcile its existing receipt', {
      status: 409, code: 'prepared_media_node_already_submitted',
      details: { nodeId: node.id, upstreamRequestAttempted: false },
    });
  }
  const submittedData: Record<string, unknown> = {
    ...data, workflowPreparedOnly: false, mediaTaskExecutionOwner: 'canvas_prepared',
  };
  if (input.media === 'image') {
    if (!text(data.existingAssetId) && !text(data.modelKey) && !text(data.modelAlias) && !text(data.imageModel)) throw new AppError('Prepared image has no explicit model selection', {
      status: 422, code: 'prepared_media_model_missing',
    });
  } else {
    for (const [nodeField, urlField] of [
      ['firstFrameImageNodeId', 'firstFrameUrl'], ['lastFrameImageNodeId', 'lastFrameUrl'],
    ] as const) {
      const fromNodeField = nodeField === 'firstFrameImageNodeId' ? 'firstFrameFromNodeId' : 'lastFrameFromNodeId';
      const referenceId = text(data[nodeField]) || text(data[fromNodeField]);
      if (text(data[nodeField]) && text(data[fromNodeField]) && data[nodeField] !== data[fromNodeField]) {
        throw new AppError('Prepared video frame handles disagree', {
          status: 422, code: 'prepared_media_frame_identity_conflict',
          details: { nodeId: node.id, nodeField, fromNodeField, upstreamRequestAttempted: false },
        });
      }
      if (!referenceId) continue;
      const reference = record(nodes.find((candidate) => candidate.id === referenceId)?.data);
      const image = reference && reference.status === 'success'
        && (reference.kind === 'image' || reference.kind === 'imageEdit')
        ? readFirstImageResult(reference) : null;
      if (!image) throw new AppError('Prepared video frame dependency has no successful real image URL', {
        status: 422, code: 'prepared_media_frame_not_ready',
        details: { nodeId: node.id, dependencyNodeId: referenceId, upstreamRequestAttempted: false },
      });
      submittedData[urlField] = image.url;
    }
  }
  return { node: { ...node, data: submittedData } };
}
