# Dataseek fork

Fork of [maxiaovivi/dsh-cloak-browser](https://github.com/maxiaovivi/dsh-cloak-browser), based on `d652020cebd601d24c1ed39fc00175558cfc166c`. Development branch: `codex/dataseek-browser`.

## Host runtime and browser launch

The DSH LLM and tools packages remain peer dependencies, with matching development-only versions for standalone tests. The plugin uses the injected `ctx.tools` and `ctx.attachments`; it does not construct another ToolRuntime or LLM service. The default export carries Cordis `name`, `inject`, and `Config` metadata, while named exports remain available.

CloakBrowser's launch options are built normally, then `--no-sandbox` is removed and `chromiumSandbox: true` is set before launching. The upstream context helper still decides the viewport. Humanize defaults to `true`, and all original session, snapshot-ref and navigation-policy checks remain enabled.

## Network tools

- `browser_network_requests({ filter? })` lists captured requests, optionally matching a literal URL substring. It returns stable numeric indices, method, resource type, status, completion/failure, and a redacted URL.
- `browser_network_request({ index, include_body? })` reads an existing request's headers and optional response text. It never reissues the request. Response text is untrusted site data and can contain business data; opt in only when needed.

Each Agent's BrowserSession owns its log. It retains at most 200 requests, evicts the oldest, and never reuses an index in that session. Expired indices fail explicitly. Lists are capped by `maxTextChars`; each header set uses at most one quarter of that budget and body output at most one half (6,000 characters at default settings).

Authorization, Cookie, Set-Cookie and common token/key/secret fields are redacted from headers and URL query parameters. Query credentials must not be used for replay from the displayed URL. Request bodies are not returned. An opted-in response body is read only after completion, for textual content with an unencoded Content-Length of at most 64 KiB. Unknown, compressed, large and binary bodies return metadata plus an explicit reason. Browser traffic itself is unaffected. Agent disposal/plugin unload removes listeners and clears captured objects.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run test:integration
```

Unit tests cover retained upstream behavior, runtime peer dependencies/default metadata, sandbox launch settings, redaction, body limits, stable indices, isolation and cleanup. Integration tests launch real Chromium on local fixture pages, including humanized input/clicks, response inspection, isolated Agents, iframe snapshots and screenshots. Loopback is allowed only in these fixture tests; the shipped navigation policy continues to block private/local addresses.

These checks do not establish compatibility with every site, license tier, proxy or operating system, and do not refresh the upstream public anti-bot detector claims.
