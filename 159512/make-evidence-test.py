# Derives the evidence harness from the committed regression test without changing its scenario.
import re, sys
src = open(sys.argv[1]).read()
src = src.replace('import { afterEach, beforeEach, describe, expect, it } from "vitest";',
                  'import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";\nimport { writeFileSync } from "node:fs";\nimport { cliBackendLog } from "../cli-runner/log.js";')
head, sep, body = src.partition('  it("keeps the completion turn restricted')
assert sep, "scenario not found"
body = body.replace("expect(", "expect.soft(")
src = head + sep + body
src = src.replace("    const after = await readFixtureTurns();\n    expect(after)",
                  "    evidence.bindings.push({ runId: params.runId, binding: getCliSessionBinding(requesterEntry(), \"claude-cli\") ?? null });\n    const after = await readFixtureTurns();\n    expect(after)")
src = src.replace('describe("Claude CLI completion announce continuity", () => {',
                  'const evidence: { bindings: unknown[]; logLines: string[] } = { bindings: [], logLines: [] };\n\ndescribe("Claude CLI completion announce continuity", () => {')
src = src.replace("    await bindSessionMcpRuntimeTestScheduler();\n",
                  "    await bindSessionMcpRuntimeTestScheduler();\n    vi.spyOn(cliBackendLog, \"info\").mockImplementation((line: unknown) => {\n      if (typeof line === \"string\" && /^cli (exec|session reset):/.test(line)) evidence.logLines.push(line);\n    });\n", 1)
src = src.replace("  afterEach(async () => {\n",
                  "  afterEach(async () => {\n    const projectDir = resolveClaudeCliProjectDirForWorkspace({ workspaceDir: state.workspaceDir });\n    const transcripts = Object.fromEntries((await fs.readdir(projectDir).catch(() => [])).map((name) => [name, \"\"]));\n    for (const name of Object.keys(transcripts)) transcripts[name] = await fs.readFile(path.join(projectDir, name), \"utf8\");\n    writeFileSync(process.env.ANNOUNCE_EVIDENCE_OUT!, JSON.stringify({ ...evidence, turns: await readFixtureTurns(), nativeTranscripts: transcripts }, null, 2));\n    vi.restoreAllMocks();\n", 1)
open(sys.argv[2], "w").write(src)
