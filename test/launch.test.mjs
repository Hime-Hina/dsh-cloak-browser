import assert from "node:assert/strict";
import test from "node:test";
import defaultPlugin, { normalizeConfig, SessionMap } from "../lib/plugin.mjs";

test("default export declares the Cordis dependencies used by its apply function", () => {
  assert.deepEqual(defaultPlugin.inject, ["tools", "attachments"]);
  assert.equal(defaultPlugin.name, "cloak-browser");
  assert.ok(defaultPlugin.Config);
});

test("production session startup preserves fingerprints and enables Chromium sandbox", async () => {
  let launched;
  let closed = false;
  const context = { pages: () => [], on() {}, off() {}, setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, async close() { closed = true; } };
  const sessions = new SessionMap(normalizeConfig(), async () => ({
    buildLaunchOptions: async () => ({ args: ["--no-sandbox", "--fingerprint=42"], executablePath: "fixture-chromium" }),
    launchContext: async (options) => { launched = options; return context; }
  }));
  const session = await sessions.create({ id: "sandbox-check" });
  assert.equal(launched.humanize, true);
  assert.equal(launched.launchOptions.chromiumSandbox, true);
  assert.deepEqual(launched.launchOptions.args, ["--fingerprint=42"]);
  await session.close();
  assert.equal(closed, true);
});
