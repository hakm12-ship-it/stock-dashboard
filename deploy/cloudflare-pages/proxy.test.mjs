import test from "node:test";
import assert from "node:assert/strict";
import worker from "./public/_worker.js";

const site = "https://hakm-stock.pages.dev";
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
    assert.equal(request.headers.get("X-Forwarded-Host"), "hakm-stock.pages.dev");
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
  const response = await worker.fetch(new Request("https://preview.hakm-stock.pages.dev/robots.txt"));
  assert.equal(await response.text(), "User-agent: *\nDisallow: /\n");
});

test("preview pages are not indexed or cached", async t => {
  mockFetch(t, async () => new Response("<title>Stock Insight</title>", {
    headers: { "Content-Type": "text/html" },
  }));
  const response = await worker.fetch(new Request("https://preview.hakm-stock.pages.dev/"));
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

test("invalid upstream configuration cannot redirect requests to another protocol", async t => {
  let contactedUpstream = false;
  mockFetch(t, async () => { contactedUpstream = true; return new Response("unexpected"); });
  const response = await worker.fetch(new Request(site + "/"), { UPSTREAM_ORIGIN: "http://127.0.0.1" });
  assert.equal(response.status, 503);
  assert.equal(contactedUpstream, false);
});
