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
// The value is bracketed by measurement rather than chosen. Floor: the compaction
// reported in #138644 consumed 180_444ms of stream silence, so any ceiling at or
// below CLI_RESUME_WATCHDOG_DEFAULTS.maxMs reproduces that report exactly. Ceiling:
// RUN_STALE_TAKEOVER_MS already reclaims quiet runs, and a wedged compaction must not
// outlive it. That leaves (180.4s, 10 min), and 5 minutes is the round value inside
// it, 1.66x the reported silence. Both ends are asserted against the reported timing
// in execute-plugin.compaction-watchdog.test.ts, so narrowing this past the
// measurement fails a named case instead of passing quietly.
export const CLI_COMPACTION_GRACE_MS = 5 * 60_000;
