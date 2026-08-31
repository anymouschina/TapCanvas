import { resolvePositiveIntEnv } from "./concurrency-limits";

/**
 * Hard wall-clock cap for ffmpeg / ffprobe / scenedetect subprocesses.
 *
 * Previously these were spawned with only `maxBuffer` and NO timeout/kill, so a
 * hung child (corrupt input, deadlocked filtergraph, stalled decode) was never
 * killed and orphaned its full RSS — hundreds of MB for a 1080p encode — in the
 * container forever, accumulating toward OOM under repeated stalls at peak.
 *
 * Node's execFile sends `killSignal` to the child (and its group) once `timeout`
 * is exceeded, so a stuck job now dies with a bounded TTL and the promise rejects
 * (callers already map that to a failed task). Generous 15-min default so genuine
 * concat/transcode finish; override via FFMPEG_SUBPROCESS_TIMEOUT_MS.
 */
export const FFMPEG_SUBPROCESS_TIMEOUT_MS = resolvePositiveIntEnv(
  process.env.FFMPEG_SUBPROCESS_TIMEOUT_MS,
  15 * 60 * 1000,
);

export const FFMPEG_EXEC_OPTS = {
  maxBuffer: 1024 * 1024 * 64,
  timeout: FFMPEG_SUBPROCESS_TIMEOUT_MS,
  killSignal: "SIGKILL" as NodeJS.Signals,
} as const;
