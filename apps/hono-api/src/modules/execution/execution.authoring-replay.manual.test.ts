import fs from 'node:fs';
import { it, expect } from 'vitest';
import { workflowAgentPrompt, workflowAgentStructuredOutput, workflowAgentRetrievalContext, workflowAgentRetrievalUserRequest } from './execution.agent-runner';
import type { WorkflowAgentRunRequest } from './execution.node-executors';

// Offline adapter: consume a caller-supplied frozen request, never open a run or mutate a canvas.
const inputPath = process.env.WORKFLOW_AUTHORING_REPLAY_INPUT;
it.skipIf(!inputPath)('exports the actual authoring invocation for an offline text evaluation', () => {
  const input = JSON.parse(fs.readFileSync(inputPath!, 'utf8')) as {
    request: WorkflowAgentRunRequest; outputPath: string; suiteId: string;
    memoryCoreIdentity: { teamId: string; agentId: string };
  };
  const structured = workflowAgentStructuredOutput(input.request);
  expect(structured?.outputContract).toBeDefined();
  const suite = {
    version: 'agents-eval-suite/v1', suiteId: input.suiteId, title: input.suiteId,
    description: 'Offline text evaluation of a real Workflow Agent invocation; no canvas writes or media execution.',
    tags: ['workflow-replay', 'source-authority'], concurrency: 1, metadata: { taskType: 'workflow_agent_node' },
    cases: [{ caseId: 'authoring', title: 'Frozen authoring request', tags: [],
      prompt: workflowAgentPrompt(input.request), agentDefinitionId: input.request.forcedAgentRole,
      requiredSkills: input.request.requiredSkills, allowedToolNames: input.request.allowedTools,
      outputContract: structured!.outputContract, compactPrelude: true,
      expectation: { terminalStatuses: ['succeeded'], output: 'required', allowFailedToolCalls: true, requireProductiveProgress: false, completionDispositions: ['succeeded'] },
      metadata: { taskType: 'workflow_agent_node', modelKey: input.request.modelKey,
        memoryCoreIdentity: input.memoryCoreIdentity,
        retrievalUserRequest: workflowAgentRetrievalUserRequest(input.request),
        retrievalContext: workflowAgentRetrievalContext(input.request),
        promptExampleRetrievalScope: input.request.promptExampleRetrievalScope,
      },
    }],
  };
  fs.writeFileSync(input.outputPath, JSON.stringify(suite, null, 2));
});
