// Coolify runs on the same home server as the app, so it cannot report that server,
// Docker or the Tailscale Funnel going down. This Worker checks the public address
// from Cloudflare every 5 minutes and tells the owner on Telegram.
const DEFAULT_HEALTH_URL = "https://stock-insight-web.pages.dev/api/health";
const CHECK_TIMEOUT_MS = 15_000;
const TELEGRAM_TIMEOUT_MS = 10_000;
const REMINDER_MS = 6 * 60 * 60_000;
const STATE_KEY = "outage";
const CHAT_ID = /^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/;

async function checkHealth(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    // Reported like any other failure so a broken setting does not go unnoticed.
  }
  if (url?.protocol !== "https:") {
    return { ok: false, reason: "HEALTH_URL 설정 오류" };
  }
  // A plain timer rather than AbortSignal.timeout() so the tests can drive the clock.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url.href, {
      headers: { Accept: "application/json", "User-Agent": "StockInsightUptime/1.0" },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      response.body?.cancel().catch(() => {});
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // An HTML page with status 200 is not the app answering.
    }
    if (body?.status === "ok") return { ok: true };
    return { ok: false, reason: body ? 'HTTP 200, status가 "ok" 아님' : "HTTP 200, JSON 아님" };
  } catch (error) {
    return {
      ok: false,
      reason: controller.signal.aborted
        ? `응답 없음(${CHECK_TIMEOUT_MS / 1000}초 초과)`
        : `연결 실패(${error?.name ?? "Error"})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Same recipient format as the app: comma-separated, delivered if any room accepts it.
async function notify(env, text) {
  const token = String(env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chats = [...new Set(String(env.TELEGRAM_CHAT_ID ?? "").split(",").map(id => id.trim()))]
    .filter(id => CHAT_ID.test(id));
  if (!token || !chats.length) {
    console.warn("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set; message skipped");
    return false;
  }
  const results = await Promise.all(chats.map(async chat_id => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      const result = await response.json().catch(() => null);
      if (result?.ok) return true;
      console.warn(`Telegram sendMessage failed (HTTP ${response.status})`);
    } catch (error) {
      // The request URL holds the bot token; log the error type only.
      console.warn(`Telegram sendMessage failed (${error?.name ?? "Error"})`);
    }
    return false;
  }));
  return results.includes(true);
}

function kst(ms) {
  const iso = new Date(ms + 9 * 60 * 60_000).toISOString();
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

function duration(ms) {
  const minutes = Math.round(ms / 60_000);
  return [[Math.floor(minutes / 1440), "일"], [Math.floor(minutes / 60) % 24, "시간"], [minutes % 60, "분"]]
    .filter(([n]) => n).map(([n, unit]) => n + unit).join(" ") || "1분 미만";
}

async function runCheck(env, now) {
  const result = await checkHealth(env.HEALTH_URL || DEFAULT_HEALTH_URL);
  console.log(result.ok ? "health ok" : `health failed: ${result.reason}`);
  // No key while healthy, { since } after one failure, { since, notifiedAt } once the
  // owner has been told, plus okAt after the first good check of a recovery.
  // KV is written only when that changes (free plan: 1,000 a day).
  const state = await env.STATE.get(STATE_KEY, "json");
  if (result.ok) {
    if (!state) return;
    if (state.notifiedAt && !state.okAt) {
      // Two good checks in a row before "recovered", so a flapping server does not
      // send an alert/recovery pair every few minutes.
      await env.STATE.put(STATE_KEY, JSON.stringify({ ...state, okAt: now }));
      return;
    }
    if (state.notifiedAt) {
      // The outage ended at the first good check of the confirmed recovery.
      const [start, end] = [kst(state.since), kst(state.okAt)];
      // Tried once: staying "down" would resend it later with a wrong duration.
      await notify(env, `✅ 스톡 인사이트 복구\n장애 시간: 약 ${duration(state.okAt - state.since)}` +
        ` (${start} ~ ${end.slice(0, 5) === start.slice(0, 5) ? end.slice(6) : end} KST)`);
    }
    await env.STATE.delete(STATE_KEY);
    return;
  }
  if (!state) {
    // A single failure can be a blip; alert only if the next check fails too.
    await env.STATE.put(STATE_KEY, JSON.stringify({ since: now }));
    return;
  }
  if (state.okAt) {
    // Recovery was not confirmed; the outage continues from its original start.
    const { okAt, ...still } = state;
    await env.STATE.put(STATE_KEY, JSON.stringify(still));
    return;
  }
  if (state.notifiedAt && now - state.notifiedAt < REMINDER_MS) return;
  const title = state.notifiedAt ? "⏰ 스톡 인사이트 장애 계속" : "🚨 스톡 인사이트 접속 장애";
  const sent = await notify(env, [
    title,
    `원인: ${result.reason}`,
    `시작: ${kst(state.since)} KST (${duration(now - state.since)}째)`,
    "홈서버 전원·Docker·Tailscale Funnel을 확인하세요.",
  ].join("\n"));
  // An undelivered alert is not recorded, so the next check tries it again.
  if (sent) {
    await env.STATE.put(STATE_KEY, JSON.stringify({ since: state.since, notifiedAt: now }));
  }
}

export default {
  async scheduled(controller, env) {
    await runCheck(env, controller.scheduledTime ?? Date.now());
  },
};
