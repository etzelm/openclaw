// Reads run-id task ownership for subagent completion settlement.
import type { OpenClawStateDatabase } from "../../../state/openclaw-state-db.js";
import { listTaskRecordsByRunIdForViewInDatabase } from "../../../tasks/task-registry.store.kernel.js";
import type { TaskRecord, TaskRuntime } from "../../../tasks/task-registry.types.js";

export type RunIdTaskOwnership = {
  /** The subagent-owned row for this run id, when one still exists. */
  subagentOwner: TaskRecord | undefined;
  /** A runtime that holds the same run id without owning this completion. */
  foreignRuntime: TaskRuntime | undefined;
};

/**
 * Ownership facts for one run id. Run ids are not unique across runtimes, and the
 * shared run-id view returns a single preferred row whose comparator only
 * deprioritizes `cli`, so an older `cron` or `acp` row can be selected ahead of a
 * live subagent row sharing the id. Settlement reads every row instead: a surviving
 * subagent owner is authoritative, and a foreign row is only ever the reason a
 * completion has no owner of its own.
 */
export function readRunIdTaskOwnership(
  database: OpenClawStateDatabase,
  runId: string,
): RunIdTaskOwnership {
  const records = listTaskRecordsByRunIdForViewInDatabase(database.db, runId);
  return {
    subagentOwner: records.find((task) => task.runtime === "subagent"),
    foreignRuntime: records.find((task) => task.runtime !== "subagent")?.runtime,
  };
}
