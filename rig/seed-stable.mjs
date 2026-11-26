import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const root = dirname(fileURLToPath(import.meta.url));
const proof = await mkdtemp(join(root, 'seed-'));
const home = join(proof, 'home');
const tmp = join(proof, 'tmp');
await Promise.all([mkdir(home), mkdir(tmp)]);
const stableCli = join(root, 'stable/node_modules/.bin/openclaw');
let cli = stableCli;
let phase = 'stable';
const env = { PATH: process.env.PATH, HOME: home, OPENCLAW_HOME: home, TMPDIR: tmp, CI: '1', NO_COLOR: '1' };
const run = async (label, ...args) => {
  const r = await promisify(execFile)(cli, args, { cwd: proof, env, timeout: 85000, maxBuffer: 262144 });
  console.log(label + ': exit 0');
  return r.stdout.trim();
};
const marker = 'agent-profiles-stable-session-fixture-20261109';
const model = 'fixture-local';
const sessionKey = 'agent:main:profile-upgrade-proof';
const observed = [];
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', owned_by: 'fixture' }] }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  try {
    let wire = '';
    for await (const b of req) { wire += b; if (wire.length > 500000) throw new Error('request too large'); }
    const payload = JSON.parse(wire);
    const includesMarker = JSON.stringify(payload.messages).includes(marker);
    observed.push({ phase, model: payload.model, messageCount: payload.messages?.length, includesMarker });
    const common = { id: 'chatcmpl-stable-fixture', created: 1795582000, model };
    const answer = includesMarker ? marker : 'missing marker';
    if (payload.stream) {
      res.setHeader('content-type', 'text/event-stream');
      for (const choice of [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }, { index: 0, delta: {}, finish_reason: 'stop' }]) {
        res.write('data: ' + JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [choice] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104 } }));
    }
  } catch { res.writeHead(400).end(); }
});
server.listen(0, '127.0.0.1');
try {
  await once(server, 'listening');
  const version = await run('stable version', '--version');
  assert.match(version, /OpenClaw 2026\.11\.9\b/);
  await run('stable setup baseline', 'setup', '--baseline');
  const fixturePatch = join(proof, 'synthetic-config.json');
  await writeFile(fixturePatch, JSON.stringify({
    agents: { ownership: 'explicit', entries: { main: { name: 'main' }, optout: { name: 'optout', experimental: { localModelLean: false } } }, defaults: { model: { primary: 'llama-cpp/' + model }, timeoutSeconds: 90, experimental: { localModelLean: true } } },
    ui: { seamColor: '#1a73e8' },
    models: { providers: { 'llama-cpp': { api: 'openai-completions', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', models: [{ id: model, name: 'Stable proof fixture', contextWindow: 32768, maxTokens: 256 }] } } },
  }, null, 2));
  await run('stable config patch', 'config', 'patch', '--file', fixturePatch);
  await run('stable config validation', 'config', 'validate');
  const turn = await run('stable same-session seed turn', 'agent', '--local', '--agent', 'main', '--session-key', sessionKey, '--message', 'Repeat this synthetic fixture marker verbatim: ' + marker, '--json', '--timeout', '75');
  assert(turn.includes(marker), 'stable agent output did not echo the synthetic marker');
  const stdout = await run('stable persisted session read', 'sessions', '--agent', 'main', '--json');
  const sessions = JSON.parse(stdout.slice(stdout.indexOf('{')));
  const row = sessions.sessions.find((entry) => entry.key === sessionKey);
  assert(row?.sessionId, 'stable did not persist an identifiable session');
  assert(observed.some((r) => r.includesMarker), 'no real request from the stable CLI hit the loopback provider');
  const cfg = JSON.parse(await readFile(join(home, '.openclaw/openclaw.json'), 'utf8'));
  assert.equal(cfg.agents.defaults.experimental.localModelLean, true);
  assert.equal(cfg.agents.entries.optout.experimental.localModelLean, false);
  assert.equal(cfg.ui.seamColor, '#1a73e8');
  const summary = { version, stableTurn: 'ok', persistedSession: true, explicitLeanDefault: true, explicitLeanOptOut: false, unrelatedSetting: 'preserved on stable', requestCount: observed.length, loopbackRequestSawMarker: true, candidateUpgrade: 'not run' };
  await writeFile(join(proof, 'stable-seed-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  console.log('seed directory=' + proof);
  const candidate = process.env.CANDIDATE_CLI;
  if (candidate) {
    const sha = process.env.CANDIDATE_HEAD;
    const checkout = process.env.CANDIDATE_CHECKOUT;
    assert.match(sha ?? '', /^[a-f0-9]{40}$/);
    assert(checkout && isAbsolute(checkout) && isAbsolute(candidate), 'use absolute candidate paths');
    const { stdout: actualHead } = await promisify(execFile)('git', ['-C', checkout, 'rev-parse', 'HEAD'], { env });
    assert.equal(actualHead.trim(), sha, 'candidate checkout moved or was not pinned');
    await promisify(execFile)('git', ['-C', checkout, 'diff', '--quiet', 'HEAD', '--'], { env });
    const cliPath = await realpath(candidate);
    const withinCheckout = relative(await realpath(checkout), cliPath);
    assert.equal(withinCheckout, 'openclaw.mjs', 'use the repository launcher at the root of the pinned candidate checkout');
    cli = cliPath;
    phase = 'candidate';
    const candidateVersion = await run('candidate version', '--version');
    await run('candidate migration', 'doctor', '--fix', '--non-interactive');
    await run('candidate config validation', 'config', 'validate');
    const after = JSON.parse(await readFile(join(home, '.openclaw/openclaw.json'), 'utf8'));
    assert.equal(after.agents.defaults.agentProfileId, 'openclaw/small');
    assert.equal(after.agents.entries.optout.agentProfileId, 'openclaw/base');
    assert.equal(after.agents.defaults.experimental?.localModelLean, undefined);
    assert.equal(after.agents.entries.optout.experimental?.localModelLean, undefined);
    assert.equal(after.ui.seamColor, cfg.ui.seamColor);
    assert.equal(after.agents.defaults.timeoutSeconds, cfg.agents.defaults.timeoutSeconds);
    assert.deepEqual(after.agents.defaults.model, cfg.agents.defaults.model);
    assert.equal(after.agents.ownership, cfg.agents.ownership);
    assert.equal(after.models.providers['llama-cpp'].baseUrl, cfg.models.providers['llama-cpp'].baseUrl);
    const stored = JSON.parse(await run('candidate pre-turn persisted session read', 'sessions', '--agent', 'main', '--json'));
    assert.equal(stored.sessions.find((entry) => entry.key === sessionKey)?.sessionId, row.sessionId);
    const continued = await run('candidate continued stored session', 'agent', '--local', '--agent', 'main', '--session-key', sessionKey, '--message', 'Return only the exact synthetic marker from the prior turn.', '--json', '--timeout', '75');
    assert(continued.includes(marker), 'candidate reply did not include the earlier marker');
    assert(observed.some((entry) => entry.phase === 'candidate' && entry.includesMarker), 'candidate request did not carry the stored marker');
    const verified = { ...summary, candidateHead: sha, candidateVersion, candidateUpgrade: 'pass', migratedDefault: 'openclaw/small', migratedOptOut: 'openclaw/base', samePersistedSession: true, continuedProviderRequestSawStoredMarker: true };
    await writeFile(join(proof, 'upgrade-verification.json'), JSON.stringify(verified, null, 2) + '\n');
    console.log(JSON.stringify(verified));
  }
} catch (error) {
  console.error(JSON.stringify({ error: String(error.message).slice(0, 1300), stderr: String(error.stderr ?? '').slice(-2600), stdout: String(error.stdout ?? '').slice(-1000) }));
  console.error('seed directory=' + proof);
  process.exitCode = 1;
} finally {
  server.close();
  server.closeAllConnections();
}
