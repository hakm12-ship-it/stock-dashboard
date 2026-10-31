import test from "node:test";
import assert from "node:assert/strict";
import worker from "./public/_worker.js";

const site = "https://stock-insight-web.pages.dev";
const upstream = "https://homeserver.tail0376c9.ts.net:8443";

function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

test("portfolio POST keeps the body and authentication on the home-server origin", async t => {
  const body = JSON.stringify({ positions: [] });
  mockFetch(t, async request => {
    assert.equal(request.url, upstream + "/api/portfolio-review?comment=false");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("Authorization"), "Bearer test-token");
    assert.equal(request.headers.get("X-Forwarded-Host"), "stock-insight-web.pages.dev");
    assert.equal(await request.text(), body);
    return Response.json({ available: true });
  });
  const response = await worker.fetch(new Request(site + "/api/portfolio-review?comment=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body,
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("protocol-relative paths cannot turn the proxy into an arbitrary-host relay", async t => {
  mockFetch(t, async request => {
    assert.equal(new URL(request.url).origin, upstream);
    assert.equal(new URL(request.url).pathname, "//other.example/api");
    return new Response("ok");
  });
  assert.equal((await worker.fetch(new Request(site + "//other.example/api"))).status, 200);
});

test("private API errors retain their status and stay out of search", async t => {
  mockFetch(t, async () => Response.json({ detail: "Unauthorized" }, { status: 401 }));
  const response = await worker.fetch(new Request(site + "/api/kakao-token-status"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.deepEqual(await response.json(), { detail: "Unauthorized" });
});

test("home-server redirects remain on the public address", async t => {
  mockFetch(t, async request => {
    assert.equal(request.redirect, "manual");
    return new Response(null, { status: 308, headers: { Location: upstream + "/calendar?view=month" } });
  });
  const response = await worker.fetch(new Request(site + "/calendar/"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("Location"), site + "/calendar?view=month");
});

test("an external redirect is returned without forwarding credentials to its target", async t => {
  let calls = 0;
  mockFetch(t, async request => {
    calls++;
    assert.equal(new URL(request.url).origin, upstream);
    assert.equal(request.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://accounts.example/login" } });
  });
  const response = await worker.fetch(new Request(site + "/kakao-admin", {
    headers: { Authorization: "Bearer test-token" },
  }));
  assert.equal(response.headers.get("Location"), "https://accounts.example/login");
  assert.equal(calls, 1);
});

test("preview robots excludes every path without contacting the home server", async t => {
  mockFetch(t, async () => { assert.fail("preview robots must not call upstream"); });
  const response = await worker.fetch(new Request("https://preview.stock-insight-web.pages.dev/robots.txt"));
  assert.equal(await response.text(), "User-agent: *\nDisallow: /\n");
});

test("preview pages are not indexed or cached", async t => {
  mockFetch(t, async () => new Response("<title>Stock Insight</title>", {
    headers: { "Content-Type": "text/html" },
  }));
  const response = await worker.fetch(new Request("https://preview.stock-insight-web.pages.dev/"));
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("upstream failure returns a temporary response without disclosing internal errors", async t => {
  mockFetch(t, async () => { throw new Error("private diagnostic"); });
  const response = await worker.fetch(new Request(site + "/"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.ok(!(await response.text()).includes("private diagnostic"));
});

const cloudflareDnsError = () => new Response(
  "<title>Error 1016</title><p>Origin DNS error</p><p>homeserver.tail0376c9.ts.net</p>",
  { status: 530, headers: { "Content-Type": "text/html; charset=UTF-8", Server: "cloudflare" } },
);

function assertUnavailable(response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(response.headers.get("Server"), null);
}

test("a Cloudflare origin DNS error on the API becomes a JSON 503 without the upstream host", async t => {
  mockFetch(t, async () => cloudflareDnsError());
  const response = await worker.fetch(new Request(site + "/api/health", {
    headers: { Accept: "application/json" },
  }));
  assertUnavailable(response);
  assert.match(response.headers.get("Content-Type"), /^application\/json/);
  const text = await response.text();
  assert.ok(!text.includes("tail0376c9") && !text.includes("1016"));
  assert.ok(JSON.parse(text).detail.includes("잠시 후 다시 시도"));
});

test("a page navigation during an outage gets a small Korean maintenance page", async t => {
  mockFetch(t, async () => cloudflareDnsError());
  const response = await worker.fetch(new Request(site + "/calendar", {
    headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  }));
  assertUnavailable(response);
  assert.match(response.headers.get("Content-Type"), /^text\/html/);
  const html = await response.text();
  assert.ok(html.includes("잠시 점검 중"));
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'));
  assert.ok(!html.includes("tail0376c9") && !html.includes("1016"));
});

test("an API request that accepts HTML still gets JSON during an outage", async t => {
  mockFetch(t, async () => cloudflareDnsError());
  const response = await worker.fetch(new Request(site + "/api/health", {
    headers: { Accept: "text/html" },
  }));
  assertUnavailable(response);
  assert.match(response.headers.get("Content-Type"), /^application\/json/);
});

test("every Cloudflare and tunnel origin-error status is treated as upstream unavailable", async t => {
  let status;
  mockFetch(t, async () => new Response("origin error from homeserver.tail0376c9.ts.net", { status }));
  for (status of [502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]) {
    const response = await worker.fetch(new Request(site + "/assets/app.js"));
    assertUnavailable(response);
    assert.match(response.headers.get("Content-Type"), /^text\/plain/);
    assert.ok(!(await response.text()).includes("tail0376c9"), `status ${status}`);
  }
});

test("a navigation that fails to connect also gets the maintenance page", async t => {
  mockFetch(t, async () => { throw new Error("private diagnostic"); });
  const response = await worker.fetch(new Request(site + "/", { headers: { Accept: "text/html" } }));
  assertUnavailable(response);
  const html = await response.text();
  assert.ok(html.includes("잠시 점검 중") && !html.includes("private diagnostic"));
});

test("preview hosts get the same controlled response during an outage", async t => {
  mockFetch(t, async () => cloudflareDnsError());
  const response = await worker.fetch(new Request("https://preview.stock-insight-web.pages.dev/", {
    headers: { Accept: "text/html" },
  }));
  assertUnavailable(response);
});

test("intentional app 5xx responses pass through unchanged", async t => {
  const detail = "알림 관리자 인증 키가 설정되지 않았습니다.";
  let status;
  mockFetch(t, async () => Response.json({ detail }, { status }));
  for (status of [500, 503]) {
    const response = await worker.fetch(new Request(site + "/api/kakao-alert-status", {
      headers: { Authorization: "Bearer test-token" },
    }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Retry-After"), null);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
    assert.deepEqual(await response.json(), { detail });
  }
});

test("invalid upstream configuration cannot redirect requests to another protocol", async t => {
  let contactedUpstream = false;
  mockFetch(t, async () => { contactedUpstream = true; return new Response("unexpected"); });
  const response = await worker.fetch(new Request(site + "/"), { UPSTREAM_ORIGIN: "http://127.0.0.1" });
  assert.equal(response.status, 503);
  assert.equal(contactedUpstream, false);
});
