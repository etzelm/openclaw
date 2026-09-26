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
// no end record is detected here rather than a quarter hour later.
//
// The value is derived, not picked. Floor, measured: the compaction reported in
// #138644 consumed 180_444ms of stream silence, so any ceiling at or below
// CLI_RESUME_WATCHDOG_DEFAULTS.maxMs reproduces that report exactly. Point, derived:
// this is RUN_STALE_TAKEOVER_MS halved, so a wedged compaction is always detected with
// a full half-window of margin before the stale-run takeover could race it. Halving
// that window is the only rule applied, it yields exactly one value, and that value
// clears the measured floor at 1.66x.
//
// Both facts are pinned in execute-plugin.compaction-watchdog.test.ts: the floor
// against the reported timing, and the halving against RUN_STALE_TAKEOVER_MS itself.
// Changing this constant alone fails a named case instead of passing quietly.
export const CLI_COMPACTION_GRACE_MS = 5 * 60_000;
