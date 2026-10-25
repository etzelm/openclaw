import { uniqueStrings } from "@openclaw/normalization-core/string-normalization";
import {
  createSqliteQueryCache,
  prepareSqliteQueryTakeFirstSync,
} from "../../infra/kysely-sync.js";
import type { EngineConnection } from "../../infra/sql-connection.js";
import type { OpenClawAgentDatabase } from "../../state/openclaw-agent-db.js";
import { getSessionKysely, type ResolvedTranscriptScope } from "./session-accessor.sqlite-scope.js";
import { projectTranscriptNavigationSql } from "./session-model-context-projection.js";
import { selectSessionTranscriptProjectionState } from "./session-transcript-index.js";
import { foldedSessionKeyAliasCandidates, normalizeStoreSessionKey } from "./store-entry.js";
import { transcriptEventNavigationSql } from "./transcript-payload.js";

export const transcriptMutationStateQuery = createSqliteQueryCache((database: EngineConnection) => {
  const db = getSessionKysely(database);
  return prepareSqliteQueryTakeFirstSync<
    string,
    { transcript_observed_at: number | null; transcript_updated_at: number | null }
  >(database, (parameter) =>
    db
      .selectFrom("session_windows")
      .select(["transcript_observed_at", "transcript_updated_at"])
      .where(
        "session_id",
        "=",
        parameter((sessionId) => sessionId),
      ),
  );
});

export function selectTranscriptSessionRoot(
  database: OpenClawAgentDatabase,
  scope: ResolvedTranscriptScope,
) {
  const db = getSessionKysely(database.db);
  const lookupKeys = uniqueStrings([
    scope.sessionKey,
    ...foldedSessionKeyAliasCandidates(normalizeStoreSessionKey(scope.sessionKey)),
  ]);
  // The seed preserves window ownership even when its logical node is absent.
  return db
    .selectFrom(db.selectNoFrom((eb) => eb.val(scope.sessionId).as("session_id")).as("target"))
    .leftJoin("session_windows as window", "window.session_id", "target.session_id")
    .leftJoin("session_nodes as node", (join) => join.on("node.session_key", "in", lookupKeys))
    .select([
      "node.current_session_id",
      "node.entry_valid",
      "node.session_key",
      "node.updated_at",
      "node.entry_json",
      "window.session_key as persisted_session_key",
    ])
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom("session_windows as retained")
            .select("retained.session_id")
            .whereRef("retained.session_id", "=", "node.current_session_id")
            .whereRef("retained.session_key", "=", "node.session_key"),
        )
        .as("retained_window"),
    );
}

export type TranscriptSessionRootRow = Awaited<
  ReturnType<ReturnType<typeof selectTranscriptSessionRoot>["execute"]>
>[number];

export function selectTranscriptAppendState(
  database: OpenClawAgentDatabase,
  scope: ResolvedTranscriptScope,
  withLatestIdentity = false,
) {
  const db = getSessionKysely(database.db);
  // The append parent's latest identity shares this locked read instead of its own statement.
  const latestIdentity = db
    .selectFrom("transcript_event_identities as ti")
    .innerJoin("transcript_events as te", (join) =>
      join.onRef("te.session_id", "=", "ti.session_id").onRef("te.seq", "=", "ti.seq"),
    )
    .select([
      "ti.seq",
      "ti.event_type",
      projectTranscriptNavigationSql(
        database.db,
        transcriptEventNavigationSql(database.db, "te"),
      ).as("event_json"),
    ])
    .where("ti.session_id", "=", scope.sessionId)
    .orderBy("ti.seq", "desc")
    .limit(1);
  return selectTranscriptSessionRoot(database, scope)
    .leftJoin(
      "transcript_rewrite_watermarks as generation",
      "generation.session_id",
      "target.session_id",
    )
    .leftJoin(
      selectSessionTranscriptProjectionState(database.db, scope.sessionId).as("projection"),
      (join) => join.onTrue(),
    )
    .select([
      "window.row_transcript_json",
      "window.row_transcript_updated_at",
      "window.transcript_updated_at",
      "generation.generation",
      "projection.active_event_count",
      "projection.active_message_count",
      "projection.indexed_seq",
      "projection.leaf_event_id",
      "projection.needs_rebuild",
      "projection.has_unclassified",
    ])
    .$if(withLatestIdentity, (query) =>
      query
        .leftJoin(latestIdentity.as("latest_identity"), (join) => join.onTrue())
        .select([
          "latest_identity.seq as latest_identity_seq",
          "latest_identity.event_type as latest_identity_event_type",
          "latest_identity.event_json as latest_identity_event_json",
        ]),
    )
    .select((eb) => [
      eb
        .selectFrom("transcript_events")
        .select((inner) => inner.fn.max<number>("seq").as("seq"))
        .where("session_id", "=", scope.sessionId)
        .as("max_seq"),
      eb
        .exists(
          eb
            .selectFrom("session_transcript_cold_archives")
            .select("session_id")
            .where("session_id", "=", scope.sessionId),
        )
        .as("cold"),
    ]);
}

/** Null when the session has no identity yet. */
export function readTranscriptAppendLatestIdentity(row: {
  latest_identity_seq?: number | null;
  latest_identity_event_type?: string | null;
  latest_identity_event_json?: string | null;
}) {
  return row.latest_identity_seq === null || row.latest_identity_seq === undefined
    ? null
    : {
        event_type: row.latest_identity_event_type ?? null,
        event_json: row.latest_identity_event_json!,
      };
}
