// Preloaded into the openclaw process (NODE_OPTIONS=--import). Sends only the Anthropic OAuth
// profile request to the harness STUB (profile-stub.mjs) on FAKE_PROFILE_PORT, with the same
// method, headers and signal; every other fetch is untouched. Production code is unchanged.
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  if (url === PROFILE_URL && process.env.FAKE_PROFILE_PORT) {
    return realFetch(`http://127.0.0.1:${process.env.FAKE_PROFILE_PORT}/api/oauth/profile`, init);
  }
  return realFetch(input, init);
};
