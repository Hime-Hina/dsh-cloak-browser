import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { NetworkLog } from "../lib/network.mjs";

function capture(context, extraHeaders = {}, content = "fixture") {
  let reads = 0;
  const request = {
    url: () => "https://example.com/data?access_token=hidden&signature=a%2fb+%20&record=42",
    method: () => "GET", resourceType: () => "fetch",
    headers: () => ({ authorization: "Bearer hidden", cookie: "session=hidden", accept: "text/plain" }),
    failure: () => ({ errorText: "net::ERR_FAILED" })
  };
  const response = {
    request: () => request, status: () => 200,
    headers: () => ({ "content-type": "text/plain", "content-length": String(Buffer.byteLength(content)), "set-cookie": "session=hidden", ...extraHeaders }),
    body: async () => { reads++; return Buffer.from(content); }
  };
  context.emit("request", request);
  context.emit("response", response);
  context.emit("requestfinished", request);
  return { request, reads: () => reads };
}

test("captured requests preserve credentials and encoding, stay session-local, and are never replayed", async () => {
  const context = new EventEmitter();
  const log = new NetworkLog(context);
  const other = new NetworkLog(new EventEmitter());
  const location = "https://example.com/download?signature=a%2fb+%20&key=fixture";
  const fixture = capture(context, { location });
  assert.equal(other.list().requests.length, 0);
  assert.equal(log.list("record=42").requests.length, 1);
  assert.equal(log.list("absent").requests.length, 0);
  const detail = await log.detail(1);
  assert.equal(log.list("access_token=hidden").requests[0].url, fixture.request.url());
  assert.equal(detail.url, fixture.request.url());
  assert.equal(detail.requestHeaders.authorization, "Bearer hidden");
  assert.equal(detail.requestHeaders.cookie, "session=hidden");
  assert.equal(detail.responseHeaders["set-cookie"], "session=hidden");
  assert.equal(detail.responseHeaders.location, location);
  assert.equal(fixture.reads(), 0);
  assert.equal((await log.detail(1, true)).body, "fixture");
  assert.equal(fixture.reads(), 1);
  context.emit("requestfailed", fixture.request);
  assert.match((await log.detail(1)).failure, /ERR_FAILED/);
  log.close();
  assert.equal(context.listenerCount("request"), 0);
  assert.equal(log.list().requests.length, 0);
});

test("body inspection rejects unknown, large, compressed and binary payloads without reading them", async () => {
  for (const headers of [{ "content-length": "" }, { "content-length": "999999" }, { "content-encoding": "gzip" }, { "content-type": "application/zip" }]) {
    const context = new EventEmitter();
    const log = new NetworkLog(context);
    const fixture = capture(context, headers);
    assert.ok((await log.detail(1, true)).bodyUnavailable);
    assert.equal(fixture.reads(), 0);
    log.close();
  }
});

test("capture eviction keeps stable indices and output text stays bounded", async () => {
  const context = new EventEmitter();
  const log = new NetworkLog(context, 1000);
  for (let i = 0; i < 201; i++) capture(context, {}, "a".repeat(2000));
  assert.equal(log.list().dropped, 1);
  assert.equal(log.list().requests[0].index, 2);
  assert.equal(log.list().truncated, true);
  await assert.rejects(log.detail(1), /expired/);
  await assert.rejects(log.detail(-1), /positive integer/);
  const detail = await log.detail(201, true);
  assert.equal(detail.body.length, 500);
  assert.equal(detail.bodyTruncated, true);
  log.close();
});
