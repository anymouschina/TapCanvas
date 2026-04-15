import type { EvidenceBundle } from "../../types/index.js";

export type WorkspaceContextFile = {
  name: string;
  path: string;
  content: string;
  charCount: number;
};

export type WorkspaceContext = {
  rootDir: string;
  files: WorkspaceContextFile[];
  evidenceBundles: EvidenceBundle[];
  promptFragment: string;
  summary: string;
};

export type ResolveWorkspaceContextParams = {
  workspaceRoot: string;
  cwd: string;
  resourceRoots?: string[];
  maxCharsPerFile?: number;
  maxTotalChars?: number;
};
