// usage: node optin.mjs <openclaw.json> on|off
// Sets plugins.entries.anthropic.config.historyRecovery.attestNativeLogin, the operator's opt-in
// to sending the native Claude token to Anthropic's profile endpoint. "off" removes the key.
import fs from "node:fs";
const [file, mode] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.plugins ??= {};
config.plugins.entries ??= {};
const entry = (config.plugins.entries.anthropic ??= {});
if (mode === "on") {
  entry.config = { ...entry.config, historyRecovery: { attestNativeLogin: true } };
} else {
  delete entry.config?.historyRecovery;
  if (entry.config && Object.keys(entry.config).length === 0) delete entry.config;
  if (Object.keys(entry).length === 0) delete config.plugins.entries.anthropic;
  if (Object.keys(config.plugins.entries).length === 0) delete config.plugins.entries;
  if (Object.keys(config.plugins).length === 0) delete config.plugins;
}
fs.writeFileSync(file, JSON.stringify(config));
