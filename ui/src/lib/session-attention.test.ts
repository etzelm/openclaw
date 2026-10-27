// @vitest-environment node
import { expect, it } from "vitest";
import { isUnacknowledgedSessionFailure } from "./session-attention.ts";

it("keeps a failure an alert until it is read, and alerts again for a later failure", () => {
  const failed = { status: "failed", endedAt: 10, updatedAt: 12 } as const;
  expect(isUnacknowledgedSessionFailure(failed)).toBe(true);
  expect(isUnacknowledgedSessionFailure({ ...failed, lastReadAt: 10 })).toBe(false);
  expect(isUnacknowledgedSessionFailure({ ...failed, endedAt: 20, lastReadAt: 10 })).toBe(true);
  expect(isUnacknowledgedSessionFailure({ status: "timeout", updatedAt: 5 })).toBe(true);
  expect(isUnacknowledgedSessionFailure({ status: "killed", endedAt: 10 })).toBe(false);
});
