import { spawnSync } from "node:child_process";

type ClipboardCommand = {
  command: string;
  args: string[];
};

export type ClipboardCopyResult = {
  ok: boolean;
  message: string;
};

function resolveClipboardCommands(): ClipboardCommand[] {
  switch (process.platform) {
    case "darwin":
      return [{ command: "pbcopy", args: [] }];
    case "win32":
      return [{ command: "clip", args: [] }];
    default:
      return [
        { command: "wl-copy", args: [] },
        { command: "xclip", args: ["-selection", "clipboard"] },
        { command: "xsel", args: ["--clipboard", "--input"] },
      ];
  }
}

export function copyTextToClipboard(text: string): ClipboardCopyResult {
  const normalized = String(text || "");
  if (!normalized.trim()) {
    return {
      ok: false,
      message: "没有可复制的内容。",
    };
  }

  const commands = resolveClipboardCommands();
  for (const candidate of commands) {
    const result = spawnSync(candidate.command, candidate.args, {
      input: normalized,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (!result.error && result.status === 0) {
      return {
        ok: true,
        message: "已复制最后一条 assistant 回复到系统剪贴板。",
      };
    }
  }

  const hint =
    process.platform === "linux"
      ? "（需要 wl-copy、xclip 或 xsel 之一）"
      : "";
  return {
    ok: false,
    message: `复制失败：当前环境没有可用的系统剪贴板命令${hint}`,
  };
}
