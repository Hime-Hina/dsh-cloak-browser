# Dataseek fork

Fork of [maxiaovivi/dsh-cloak-browser](https://github.com/maxiaovivi/dsh-cloak-browser), based on `d652020cebd601d24c1ed39fc00175558cfc166c`. Development branch: `codex/dataseek-browser`.

## Host runtime and browser launch

The DSH LLM and tools packages remain peer dependencies, with matching development-only versions for standalone tests. The plugin uses the injected `ctx.tools` and `ctx.attachments`; it does not construct another ToolRuntime or LLM service. The default export carries Cordis `name`, `inject`, and `Config` metadata, while named exports remain available.

CloakBrowser's launch options are built normally, then `--no-sandbox` is removed and `chromiumSandbox: true` is set before launching. The upstream context helper still decides the viewport. Humanize defaults to `true`, and all original session, snapshot-ref and navigation-policy checks remain enabled.

## Navigation waiting

`browser_open({ url?, wait_until? })` and `browser_navigate({ url, wait_until? })`
accept `commit`, `domcontentloaded`, `load`, and `networkidle`. Omission keeps the
existing `domcontentloaded` default; `browser_open` without a URL only opens a
session. Invalid choices are rejected by the tool input schema.

Use `commit` when a page's pending resources prevent DOMContentLoaded but the task
can read already available content. It waits for navigation commitment, not for
the target element or a complete document. Follow it with `browser_wait({ text })`;
that wait returns a fresh snapshot. If a redirect causes `snapshotError`, wait for
the target and refresh as needed instead of repeating navigation. Existing URL
checks, navigation policy, browser calibration, output bounds and cancellation
remain active. Do not act on refs from a snapshot invalidated by later navigation.

The default navigation timeout is 30 seconds. With automatic snapshots enabled,
`browser_open` declares a 45-second tool timeout to the host (30-second navigation
plus a 15-second observation allowance); this is not an independent deadline on
each internal snapshot step. A caller that invokes `execute()` directly must
provide its own cancellation budget. An earlier caller deadline can cancel the
whole operation before navigation's timeout expires.

## Network tools

- `browser_network_requests({ filter? })` lists captured requests, optionally matching a literal URL substring. It returns stable numeric indices, method, resource type, status, completion/failure, and the original URL subject to the output limit.
- `browser_network_request({ index, include_body? })` reads an existing request's headers and optional response text. It never reissues the request. Response text is untrusted site data and can contain business data; opt in only when needed.

Each Agent's BrowserSession owns its log. It retains at most 200 requests, evicts the oldest, and never reuses an index in that session. Expired indices fail explicitly. Lists are capped by `maxTextChars`; each header set uses at most one quarter of that budget and body output at most one half (6,000 characters at default settings).

URLs and headers retain their original values, including Authorization, Cookie, Set-Cookie and signing parameters, for authorized data acquisition. URL encoding and parameter order are preserved. Existing output limits still apply: URLs are capped at 2,000 characters and non-URL header values at 500 characters, so bounded output is not guaranteed to be a complete replay request. These values enter the Agent context and may be retained in private session logs; do not publish them or commit them to Git.

Request bodies are not returned. An opted-in response body is read only after completion, for textual content with an unencoded Content-Length of at most 64 KiB. Unknown, compressed, large and binary bodies return metadata plus an explicit reason. Browser traffic itself is unaffected. Agent disposal/plugin unload removes listeners and clears captured objects.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run test:integration
```

Unit tests cover retained upstream behavior, runtime peer dependencies/default metadata, sandbox launch settings, original URL/header preservation, body limits, stable indices, isolation and cleanup. Integration tests launch real Chromium on local fixture pages, including humanized input/clicks, response inspection, isolated Agents, iframe snapshots and screenshots. Loopback is allowed only in these fixture tests; the shipped navigation policy continues to block private/local addresses.

These checks do not establish compatibility with every site, license tier, proxy or operating system, and do not refresh the upstream public anti-bot detector claims.
