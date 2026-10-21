import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createCloakBrowserPlugin } from "../lib/plugin.mjs";

process.env.CLOAKBROWSER_AUTO_UPDATE = "false";

test("commit navigation observes target content while a parser-blocking script remains pending", { timeout: 30000 }, async () => {
  let navigations = 0;
  const server = createServer((request, response) => {
    // Keep a synchronous script pending without changing page safety settings.
    // The target is before it, so reading the target need not wait for DOMContentLoaded.
    if (request.url === "/pending.js") return;
    navigations += 1;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><title>Commit fixture</title><a href="/data.csv">Dataset ready</a><script src="/pending.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const tools = new Map(), disposers = [], contexts = [];
  const plugin = createCloakBrowserPlugin({ browserApiLoader: async () => {
    const api = await import("cloakbrowser");
    return { ...api, launchContext: async options => {
      assert.equal(options.launchOptions.chromiumSandbox, true);
      assert.ok(!options.launchOptions.args.includes("--no-sandbox"));
      const context = await api.launchContext(options);
      contexts.push(context);
      return context;
    } };
  } });
  plugin.apply({ tools: { register: tool => tools.set(tool.name, tool) }, on() {}, effect: fn => disposers.push(fn()) },
    { routePrompt: false, headless: true, blockPrivateNetworks: false, navigationTimeoutMs: 1000 });
  const exec = { agent: { id: "commit-navigation-fixture" }, signal: new AbortController().signal };
  const call = (name, args) => tools.get(name).execute(args, exec);
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    // The default remains DOMContentLoaded and must still time out on this fixture.
    await assert.rejects(call("browser_open", { url }), /Timeout 1000ms exceeded/);
    for (const name of ["browser_open", "browser_navigate"]) {
      const result = await call(name, { url, wait_until: "commit" });
      assert.ok(["open", "navigated"].includes(result.status));
      const observed = await call("browser_wait", { text: "Dataset ready" });
      assert.equal(observed.snapshot.title, "Commit fixture");
      assert.ok(observed.snapshot.elements.some(item => item.role === "link" && item.name === "Dataset ready"));
      assert.equal(await contexts[0].pages()[0].evaluate(() => document.readyState), "loading");
    }
    assert.equal(navigations, 3, "observing the target must not repeat navigation");
    await call("browser_close", {});
    assert.ok(contexts.every(context => !context.browser().isConnected()));
  } finally {
    for (const dispose of disposers) await dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
