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

function unavailable() {
  return new Response("사이트 연결을 잠시 확인하고 있어요. 잠시 후 다시 시도해 주세요.", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Retry-After": "30",
    },
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
      return unavailable();
    }
  },
};
