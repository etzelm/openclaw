import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionTranscriptRuntimeTarget } from "./session-accessor.types.js";

export type CliHistoryWriter = {
  target: SessionTranscriptRuntimeTarget;
  runId: string;
  authFingerprint: string;
  lifecycleRevision?: string;
  /** Run authority plus, for a native login owner, a fresh login lookup. Guards coverage commits. */
  assertCurrent: () => void;
  /** assertCurrent plus the stored coverage proof, before saved history reaches the CLI. */
  assertReadable: () => void;
};

/** The writer as the executing run holds it; workers only ever see the base capability. */
export type CliExecutionHistoryWriter = CliHistoryWriter & {
  /** True when ownership comes from a native login resolved from the child environment. */
  bindsNativeLogin: boolean;
  /** Cheaper check for output events after the prompt was delivered; never looks up the login. */
  assertStream: (recovering: boolean) => void;
  /** Resolve the native login owner from the environment execution actually spawns with. */
  bindExecutionEnv: (env: NodeJS.ProcessEnv) => void;
};

const cliHistoryWriter = new AsyncLocalStorage<CliHistoryWriter>();

export function runWithCliHistoryWriter<T>(writer: CliHistoryWriter | undefined, run: () => T): T {
  return writer ? cliHistoryWriter.run(writer, run) : cliHistoryWriter.exit(run);
}

export function getCliHistoryWriter(
  target: Partial<SessionTranscriptRuntimeTarget>,
): CliHistoryWriter | undefined {
  const writer = cliHistoryWriter.getStore();
  return writer &&
    writer.target.agentId === target.agentId &&
    writer.target.sessionId === target.sessionId &&
    writer.target.sessionKey === target.sessionKey &&
    writer.target.storePath === target.storePath
    ? writer
    : undefined;
}

/** Private proof of the account that owns every covered transcript event. */
export type CliHistoryBoundary =
  | { version: 1; sessionId: string; state: "unknown" }
  | {
      version: 1;
      sessionId: string;
      state: "known";
      authFingerprint: string;
      generation: string | null;
      maxSeq: number | null;
      writerRunId: string;
    };

export function isKnownCliHistoryBoundary(
  boundary: CliHistoryBoundary | undefined,
): boundary is Extract<CliHistoryBoundary, { state: "known" }> {
  return (
    boundary?.version === 1 &&
    boundary.state === "known" &&
    typeof boundary.sessionId === "string" &&
    boundary.sessionId.length > 0 &&
    typeof boundary.authFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(boundary.authFingerprint) &&
    (boundary.generation === null ||
      (typeof boundary.generation === "string" && boundary.generation.length > 0)) &&
    (boundary.maxSeq === null ||
      (boundary.generation !== null &&
        Number.isSafeInteger(boundary.maxSeq) &&
        boundary.maxSeq >= 0)) &&
    typeof boundary.writerRunId === "string" &&
    boundary.writerRunId.length > 0
  );
}
