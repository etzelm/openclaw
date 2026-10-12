// Harness plugin: at agent_end of a turn, appends one saved note (a `custom` transcript message,
// which a later Claude CLI turn receives as "Saved session notes") through the plugin SDK, while the
// turn's history writer is still in scope. PROBE_NOTE selects the turn; PROBE_NOTE_BEFORE runs a
// shell command (the login switch) right before the append.
import { execSync } from "node:child_process";
import fs from "node:fs";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendSessionTranscriptMessageByIdentity } from "openclaw/plugin-sdk/session-transcript-runtime";

const log = (record) => {
  if (process.env.FAKE_CLAUDE_LOG) {
    fs.appendFileSync(
      process.env.FAKE_CLAUDE_LOG,
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...record }) + "\n",
    );
  }
};

export default definePluginEntry({
  id: "probe-note",
  name: "Probe Note",
  description: "Harness only: appends a saved note at agent_end.",
  register(api) {
    const onHook = (name) => async (_event, ctx) => {
      const note = process.env.PROBE_NOTE;
      if (!note || (process.env.PROBE_NOTE_HOOK ?? "agent_end") !== name) {
        return;
      }
      try {
        if (process.env.PROBE_NOTE_BEFORE) {
          execSync(process.env.PROBE_NOTE_BEFORE, { stdio: "ignore" });
          log({ event: "probe-note-before-ran" });
        }
        const result = await appendSessionTranscriptMessageByIdentity({
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
          sessionKey: ctx.sessionKey,
          config: api.config,
          message: {
            role: "custom",
            customType: "harness.note",
            content: `Saved note: the harness note is ${note}.`,
            display: true,
            timestamp: Date.now(),
          },
        });
        log({ event: "probe-note-appended", hook: name, note, appended: Boolean(result) });
      } catch (error) {
        log({ event: "probe-note-failed", hook: name, note, error: String(error?.message ?? error) });
      }
    };
    for (const name of ["llm_output", "before_agent_finalize", "agent_end"]) {
      api.on(name, onHook(name));
    }
  },
});
