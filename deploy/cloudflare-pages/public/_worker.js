// The app and its secrets stay on the home server. Pages provides a public URL.
const DEFAULT_UPSTREAM = "https://homeserver.tail0376c9.ts.net:8443";
const DEFAULT_PUBLIC_SITE = "https://stock-insight-web.pages.dev";

function origin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Expected an HTTPS origin");
  }
  return url.origin;
}

// Cloudflare's own origin errors (e.g. 530/1016 when the tunnel name stops resolving)
// and the tunnel's 502/504 mean the home server is unreachable, and their pages can
// name the upstream host. The app never returns these; its own 500/503 pass through.
const UPSTREAM_DOWN = new Set([502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
const MESSAGE = "사이트 연결을 잠시 확인하고 있어요. 잠시 후 다시 시도해 주세요.";
const MAINTENANCE_PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>잠시 점검 중 · 스톡 인사이트</title>
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;padding:24px;box-sizing:border-box;background:#17171c;color:#f2f2f5;font-family:system-ui,sans-serif;text-align:center}a{color:inherit}</style>
</head>
<body>
<h1>잠시 점검 중이에요</h1>
<p>${MESSAGE}</p>
<p><a href="">다시 시도</a></p>
</body>
</html>
`;

function unavailable(request) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Retry-After": "30",
  };
  if (new URL(request.url).pathname.startsWith("/api/")) {
    return Response.json({ detail: MESSAGE }, { status: 503, headers });
  }
  const page = (request.headers.get("Accept") || "").includes("text/html");
  return new Response(page ? MAINTENANCE_PAGE : MESSAGE, {
    status: 503,
    headers: { ...headers, "Content-Type": `text/${page ? "html" : "plain"}; charset=utf-8` },
  });
}

export default {
  async fetch(request, env = {}) {
    try {
      const upstream = origin(env.UPSTREAM_ORIGIN || DEFAULT_UPSTREAM);
      const publicSite = origin(env.PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE);
      const incoming = new URL(request.url);
      const preview = incoming.origin !== publicSite;

      if (preview && incoming.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /\n", {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex, nofollow",
          },
        });
      }

      // Assign the path separately: a path starting // cannot select another host.
      const target = new URL(upstream);
      target.pathname = incoming.pathname;
      target.search = incoming.search;
      const headers = new Headers(request.headers);
      headers.delete("Host");
      headers.delete("Forwarded");
      headers.delete("X-Forwarded-For");
      headers.set("X-Forwarded-Host", incoming.host);
      headers.set("X-Forwarded-Proto", "https");
      const forwarded = new Request(new Request(target, request), {
        headers,
        redirect: "manual",
      });

      const result = await fetch(forwarded);
      if (UPSTREAM_DOWN.has(result.status)) {
        result.body?.cancel().catch(() => {});
        return unavailable(request);
      }
      const response = new Response(result.body, result);
      const location = response.headers.get("Location");
      if (location) {
        const redirect = new URL(location, target);
        if (redirect.origin === upstream) {
          response.headers.set("Location", incoming.origin + redirect.pathname + redirect.search + redirect.hash);
        }
      }
      if (preview || incoming.pathname.startsWith("/api/") ||
          incoming.pathname.startsWith("/admin") ||
          incoming.pathname.startsWith("/kakao-")) {
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
        response.headers.set("Cache-Control", "no-store");
      }
      return response;
    } catch {
      return unavailable(request);
    }
  },
};
