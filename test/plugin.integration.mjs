import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createCloakBrowserPlugin } from "../lib/plugin.mjs";

process.env.CLOAKBROWSER_AUTO_UPDATE = "false";

test("native tools humanize input, capture responses, isolate Agents and close Chromium", { timeout: 120000 }, async () => {
  const server = createServer((request, response) => {
    const body = request.url.startsWith("/api/") ? JSON.stringify({ dataset: 42 }) : '<!doctype html><label>Query<input aria-label="Query"></label><button onclick="fetch(\'/api/data?access_token=fixture-hidden\').then(r=>r.json()).then(x=>document.querySelector(\'p\').textContent=\'Dataset \'+x.dataset)">Fetch dataset</button><p>Ready</p><script>window.keyEvents=0;document.addEventListener("keydown",()=>window.keyEvents++);</script>';
    response.setHeader("content-type", request.url.startsWith("/api/") ? "application/json" : "text/html");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.setHeader("set-cookie", "session=fixture-hidden; SameSite=Lax");
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const tools = new Map();
  const disposers = [];
  const listeners = new Map();
  const contexts = [];
  const launches = [];
  const plugin = createCloakBrowserPlugin({ browserApiLoader: async () => {
    const api = await import("cloakbrowser");
    return { ...api, launchContext: async (options) => {
      launches.push(options);
      const context = await api.launchContext(options);
      contexts.push(context);
      return context;
    } };
  } });
  plugin.apply({ tools: { register(tool) { tools.set(tool.name, tool); } }, on(name, fn) { listeners.set(name, fn); }, effect(fn) { disposers.push(fn()); } }, { routePrompt: false, blockPrivateNetworks: false });
  const subject = { id: "integration-agent" };
  const exec = { agent: subject, signal: new AbortController().signal };
  const call = (name, args = {}, execution = exec) => tools.get(name).execute(args, execution);
  try {
    const opened = await call("browser_open", { url: `http://127.0.0.1:${server.address().port}/` });
    assert.equal(launches[0].launchOptions.chromiumSandbox, true);
    assert.ok(!launches[0].launchOptions.args.includes("--no-sandbox"));
    const page = contexts[0].pages()[0];
    assert.ok(page._cloakHuman);
    const input = opened.snapshot.elements.find(item => item.role === "textbox");
    const typed = await call("browser_type", { ref: input.ref, text: "research" });
    assert.equal(await page.locator("input").inputValue(), "research");
    assert.ok(await page.evaluate(() => window.keyEvents) >= 8);
    const button = typed.snapshot.elements.find(item => item.name === "Fetch dataset");
    await call("browser_click", { ref: button.ref });
    await call("browser_wait", { text: "Dataset 42" });
    const network = await call("browser_network_requests", { filter: "/api/data" });
    assert.equal(network.requests.length, 1);
    const detail = await call("browser_network_request", { index: network.requests[0].index, include_body: true });
    assert.deepEqual(JSON.parse(detail.body), { dataset: 42 });
    assert.equal(detail.responseHeaders["set-cookie"], "[REDACTED]");
    assert.ok(!JSON.stringify(detail).includes("fixture-hidden"));
    const other = await call("browser_network_requests", {}, { agent: { id: "other-agent" }, signal: exec.signal });
    assert.equal(other.requests.length, 0);
    await listeners.get("agent/disposed")({ agent: subject });
    assert.equal(contexts[0].browser().isConnected(), false);
  } finally {
    for (const dispose of disposers) await dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
