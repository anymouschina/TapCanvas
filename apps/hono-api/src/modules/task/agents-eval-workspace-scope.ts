import { AppError } from "../../middleware/error";

type EvalWorkspaceScope = Readonly<{
  projectId: string;
  flowId: string;
  chapterId?: string;
}>;

export function assertExecutionMatchesEvalWorkspace(
  execution: Readonly<{
    project_id?: string | null;
    flow_id: string;
    canvas_id?: string | null;
  }>,
  workspace: EvalWorkspaceScope,
): void {
  // `flow_id` identifies the immutable workflow definition being executed. A
  // shared equipped workflow deliberately keeps that template identity while
  // `canvas_id` identifies the caller canvas that supplies project context and
  // receives all materialized outputs. Eval isolation therefore binds to the
  // execution project + delivery canvas, never to the workflow template flow.
  const expectedCanvasId = workspace.chapterId
    ? `chapter:${workspace.chapterId}`
    : workspace.flowId;
  if (execution.project_id === workspace.projectId && execution.canvas_id === expectedCanvasId) return;
  throw new AppError("Agent eval execution is outside the provisioned evaluation workspace", {
    status: 409,
    code: "agents_eval_execution_workspace_mismatch",
    details: {
      expectedProjectId: workspace.projectId,
      expectedCanvasId,
      actualProjectId: execution.project_id ?? null,
      actualCanvasId: execution.canvas_id ?? null,
      workflowDefinitionFlowId: execution.flow_id,
    },
  });
}
