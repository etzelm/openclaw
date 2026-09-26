// Default watchdog timing bounds for CLI-backed agent sessions.
export const CLI_WATCHDOG_MIN_TIMEOUT_MS = 1_000;

export const CLI_FRESH_WATCHDOG_DEFAULTS = {
  noOutputTimeoutRatio: 0.8,
  minMs: 180_000,
  maxMs: 600_000,
} as const;

export const CLI_RESUME_WATCHDOG_DEFAULTS = {
  noOutputTimeoutRatio: 0.3,
  minMs: 60_000,
  maxMs: 180_000,
} as const;

// Native compaction is silent but busy, so it defers the no-output watchdog. It is
// one summarization call over the transcript, not an open-ended tool call, so it
// gets this ceiling instead of BLOCKED_TOOL_CALL_ABORT_FLOOR_MS: a start record with
// no end record is detected here rather than a quarter hour later. The bound sits
// above CLI_RESUME_WATCHDOG_DEFAULTS.maxMs so a real compaction still survives, and
// below RUN_STALE_TAKEOVER_MS so a wedged one cannot outlive the window that reclaims
// quiet runs. Measured reference: a 27.5k-token compaction is ~14s of silence.
export const CLI_COMPACTION_GRACE_MS = 5 * 60_000;
