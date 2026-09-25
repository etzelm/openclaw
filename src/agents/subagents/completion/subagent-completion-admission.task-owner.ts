// Attributes run-id task ownership when subagent completion settlement refuses.
import type { OpenClawStateDatabase } from "../../../state/openclaw-state-db.js";
import { listTaskRecordsByRunIdForViewInDatabase } from "../../../tasks/task-registry.store.kernel.js";
import type { TaskRecord, TaskRuntime } from "../../../tasks/task-registry.types.js";

export type RunIdTaskOwnership = {
  /** Every row holding this run id, in lookup preference order. */
  rows: readonly TaskRecord[];
  /** A runtime holding the same run id without owning this completion. */
  foreignRuntime: TaskRuntime | undefined;
};

/**
 * Ownership facts for one run id. Run ids are not unique across runtimes and the
 * shared run-id view returns a single preferred row, so a refusal that reports only
 * "owner changed" cannot tell an operator whether the row is absent or held by another
 * runtime. Reading every row supplies that attribution. It decides nothing: settlement
 * still refuses while any row holds the id, so a completion whose execution owner
 * lives in another runtime keeps its result and its durable requester wake.
 */
export function readRunIdTaskOwnership(
  database: OpenClawStateDatabase,
  runId: string,
): RunIdTaskOwnership {
  const rows = listTaskRecordsByRunIdForViewInDatabase(database.db, runId);
  return {
    rows,
    foreignRuntime: rows.find((task) => task.runtime !== "subagent")?.runtime,
  };
}

/** Names why a completion found no subagent owner, for the settlement refusal journal. */
export function describeRunIdTaskOwnership(ownership: RunIdTaskOwnership): string {
  if (ownership.foreignRuntime) {
    return `task owner runtime is ${ownership.foreignRuntime}`;
  }
  return ownership.rows.length > 0 ? "task owner is not this completion" : "task owner is absent";
}
