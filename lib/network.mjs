const SENSITIVE = /authorization|cookie|token|api[-_]?key|secret|password|credential|signature|^(key|code|sig)$/i;
const MAX_REQUESTS = 200;
const MAX_BODY_BYTES = 64 * 1024;

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) if (SENSITIVE.test(key)) url.searchParams.set(key, "[REDACTED]");
    url.hash = "";
    return url.href.slice(0, 2000);
  } catch { return "[invalid URL]"; }
}

function safeHeaders(headers, budget) {
  const result = {};
  let size = 0;
  for (const [key, value] of Object.entries(headers)) {
    const text = SENSITIVE.test(key) ? "[REDACTED]" : /^https?:\/\//i.test(value) ? safeUrl(value) : String(value).slice(0, 500);
    size += key.length + text.length + 8;
    if (size > budget) { result["[truncated]"] = "header budget exceeded"; break; }
    result[key] = text;
  }
  return result;
}

export class NetworkLog {
  constructor(context, maxChars = 12000) {
    this.context = context;
    this.maxChars = maxChars;
    this.entries = new Map();
    this.nextIndex = 1;
    this.dropped = 0;
    this.closed = false;
    this.handlers = {
      request: (request) => {
        if (this.closed) return;
        if (this.entries.size >= MAX_REQUESTS) { this.entries.delete(this.entries.keys().next().value); this.dropped++; }
        this.entries.set(request, { index: this.nextIndex++, request, status: null, completed: false });
      },
      response: (response) => {
        const entry = this.entries.get(response.request());
        if (entry) { entry.response = response; entry.status = response.status(); }
      },
      requestfinished: (request) => { const entry = this.entries.get(request); if (entry) entry.completed = true; },
      requestfailed: (request) => {
        const entry = this.entries.get(request);
        if (entry) { entry.completed = true; entry.failure = request.failure()?.errorText?.slice(0, 200); }
      }
    };
    for (const [name, handler] of Object.entries(this.handlers)) context.on?.(name, handler);
  }

  summary(entry) {
    return { index: entry.index, url: safeUrl(entry.request.url()), method: entry.request.method(), resourceType: entry.request.resourceType(), status: entry.status, completed: entry.completed, ...(entry.failure ? { failure: entry.failure } : {}) };
  }

  list(filter = "") {
    if (typeof filter !== "string" || filter.length > 1000) throw new Error("filter must be a URL substring of at most 1000 characters");
    const requests = [];
    let size = 0;
    let truncated = false;
    for (const entry of this.entries.values()) {
      const value = this.summary(entry);
      if (!value.url.includes(filter)) continue;
      size += JSON.stringify(value).length;
      if (size > this.maxChars) { truncated = true; break; }
      requests.push(value);
    }
    return { requests, dropped: this.dropped, truncated };
  }

  async detail(index, includeBody = false) {
    if (!Number.isInteger(index) || index < 1) throw new Error("index must be a positive integer");
    const entry = [...this.entries.values()].find((item) => item.index === index);
    if (!entry) throw new Error("request index is unavailable or has expired; refresh browser_network_requests");
    const response = entry.response;
    const headers = await response?.allHeaders?.() ?? response?.headers() ?? {};
    const requestHeaders = await entry.request.allHeaders?.() ?? entry.request.headers();
    const value = { ...this.summary(entry), requestHeaders: safeHeaders(requestHeaders, this.maxChars / 4), responseHeaders: safeHeaders(headers, this.maxChars / 4) };
    if (!includeBody) return value;
    const type = headers["content-type"] ?? "";
    const length = headers["content-length"];
    if (!entry.completed || !response || entry.failure) return { ...value, bodyUnavailable: "response has not completed successfully" };
    if (!/^(text\/|application\/(json|[^;]+\+json|xml|javascript))/i.test(type)) return { ...value, bodyUnavailable: "binary/non-text response" };
    // Playwright materializes the entire body; reject unbounded or encoded payloads before calling it.
    if (!/^\d+$/.test(length ?? "") || Number(length) > MAX_BODY_BYTES || (headers["content-encoding"] && headers["content-encoding"] !== "identity")) {
      return { ...value, bodyUnavailable: "requires an unencoded Content-Length of at most 64 KiB" };
    }
    try {
      const body = await response.body();
      if (body.byteLength > MAX_BODY_BYTES) return { ...value, bodyUnavailable: "body exceeds 64 KiB" };
      const text = body.toString("utf8");
      return { ...value, body: text.slice(0, this.maxChars / 2), bodyTruncated: text.length > this.maxChars / 2 };
    } catch { return { ...value, bodyUnavailable: "response body is no longer available" }; }
  }

  close() {
    this.closed = true;
    for (const [name, handler] of Object.entries(this.handlers)) this.context.off?.(name, handler);
    this.entries.clear();
  }
}
