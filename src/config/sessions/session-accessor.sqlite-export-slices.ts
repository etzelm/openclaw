import { iterateSqliteQuerySync } from "../../infra/kysely-sync.js";
import type { OpenClawAgentDatabase } from "../../state/openclaw-agent-db.js";
import type { TranscriptEvent } from "./session-accessor.sqlite-contract.js";
import { getSessionKysely } from "./session-accessor.sqlite-scope-helpers.js";
import { readTranscriptContextVersionInTransaction } from "./session-accessor.sqlite-transcript-state.js";
import { readHotSessionTranscriptSnapshot } from "./session-cold-storage-read.js";
import { SessionTranscriptColdError } from "./session-cold-storage-state.js";
import type { SessionTranscriptContextVersion } from "./session-transcript-context-version.types.js";
import {
  captureTranscriptPayloadChunk,
  isSameTranscriptContextVersion,
  readTranscriptEventsInSlices,
  TRANSCRIPT_PAYLOAD_CHUNK_BYTES,
  type TranscriptPayloadChunk,
  type TranscriptSliceTransaction,
} from "./session-transcript-payload-chunk.js";
import { transcriptEventReadBytesSql } from "./session-transcript-read-bytes.js";
import { transcriptEventJsonSql } from "./transcript-payload.js";

type ExportDatabase = Pick<OpenClawAgentDatabase, "db" | "path">;

/** Rows after `afterSeq` through `throughSeq` that an export head left to a sliced read. */
type DeferredTranscriptRows = { deferred?: { afterSeq?: number; throughSeq: number } };

/** Export head a batch transaction read for a transcript it left to a sliced read. */
export type TranscriptExportBatchHead<Snapshot> = {
  snapshot: Snapshot;
  version: SessionTranscriptContextVersion;
};

/**
 * Reads one export snapshot: the head in the first slice's transaction (or the batch head while
 * the transcript context version still matches it), then its deferred rows in bounded slices,
 * each parsed after its transaction closed.
 */
export function readTranscriptExportInSlices<
  Snapshot extends DeferredTranscriptRows & { events: TranscriptEvent[] },
>(params: {
  sessionId: string;
  transaction: TranscriptSliceTransaction<ExportDatabase>;
  /** The export snapshot in the caller's transaction; `deferAboveBytes: 0` leaves its rows unread. */
  readHead: (database: ExportDatabase, slicing?: { deferAboveBytes: number }) => Snapshot | "cold";
  batchHead?: TranscriptExportBatchHead<Snapshot>;
  projection?: "reset-boundary";
  projectEvent?: (event: TranscriptEvent) => TranscriptEvent;
}) {
  const { sessionId, transaction, batchHead } = params;
  const hot = (snapshot: Snapshot | "cold") => {
    if (snapshot === "cold") {
      throw new SessionTranscriptColdError(sessionId);
    }
    return snapshot;
  };
  // Reset navigation is a small native projection and stays in one transaction.
  const result =
    (params.projection === "reset-boundary"
      ? undefined
      : readTranscriptEventsInSlices({
          transaction,
          projectEvent: params.projectEvent,
          readVersion: (database) => readTranscriptContextVersionInTransaction(database, sessionId),
          head: (database, version) => {
            const snapshot =
              batchHead && isSameTranscriptContextVersion(version, batchHead.version)
                ? batchHead.snapshot
                : hot(params.readHead(database, { deferAboveBytes: 0 }));
            return {
              snapshot,
              skipEvents: !snapshot.deferred,
              afterEventSeq: snapshot.deferred?.afterSeq,
              beforeEventSeq: snapshot.deferred && snapshot.deferred.throughSeq + 1,
            };
          },
          readSlice: (database, range) =>
            readTranscriptPayloadChunkFromDatabase(database, sessionId, range),
        })) ??
    transaction((database) => ({ snapshot: hot(params.readHead(database)), events: [] }));
  if (!result.found) {
    return undefined;
  }
  const { deferred: _deferred, ...snapshot } = result.value.snapshot;
  return { ...snapshot, events: [...snapshot.events, ...result.value.events] };
}

/** Captures payload text in `range`, decoded by SQLite, up to the slice budget. */
function readTranscriptPayloadChunkFromDatabase(
  database: Pick<OpenClawAgentDatabase, "db">,
  sessionId: string,
  range: { afterEventSeq?: number; beforeEventSeq?: number },
): TranscriptPayloadChunk {
  return readHotSessionTranscriptSnapshot(database, sessionId, "events", () =>
    captureTranscriptPayloadChunk(
      TRANSCRIPT_PAYLOAD_CHUNK_BYTES,
      iterateSqliteQuerySync(
        database.db,
        getSessionKysely(database.db)
          .selectFrom("transcript_events")
          .select([
            "seq",
            transcriptEventJsonSql(database.db).as("event_json"),
            transcriptEventReadBytesSql().as("payload_bytes"),
          ])
          .where("session_id", "=", sessionId)
          .$if(range.afterEventSeq !== undefined, (query) =>
            query.where("seq", ">", range.afterEventSeq!),
          )
          .$if(range.beforeEventSeq !== undefined, (query) =>
            query.where("seq", "<", range.beforeEventSeq!),
          )
          .orderBy("seq", "asc"),
      ),
    ),
  );
}
