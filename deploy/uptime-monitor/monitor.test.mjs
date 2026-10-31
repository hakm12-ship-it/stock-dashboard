import test from "node:test";
import assert from "node:assert/strict";
import worker from "./src/index.js";

const HEALTH = "https://stock-insight-web.pages.dev/api/health";
const TOKEN = "123456:fake-test-token";
const TELEGRAM = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
const MINUTE = 60_000;
const START = Date.UTC(2026, 10, 1, 5, 0); // 2026-11-01 14:00 KST

const healthy = () => Response.json({ status: "ok" });
// The Pages proxy's controlled response when the home server is unreachable.
const proxyDown = () => Response.json(
  { detail: "사이트 연결을 잠시 확인하고 있어요. 잠시 후 다시 시도해 주세요." },
  { status: 503, headers: { "Retry-After": "30" } },
);

function memoryKV() {
  const data = new Map();
  return {
    data,
    writes: 0,
    async get(key, type) {
      assert.equal(type, "json");
      return data.has(key) ? JSON.parse(data.get(key)) : null;
    },
    async put(key, value) { this.writes++; data.set(key, value); },
    async delete(key) { this.writes++; data.delete(key); },
  };
}

// Mocks fetch, KV, console and the cron clock. run(m) is the scheduled run m minutes after START.
function setup(t, { secrets = true } = {}) {
  const env = { STATE: memoryKV(), HEALTH_URL: HEALTH };
  if (secrets) Object.assign(env, { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "12345" });
  const mock = { env, health: healthy, telegram: () => Response.json({ ok: true }), messages: [], logs: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === HEALTH) return mock.health(init);
    assert.equal(url, TELEGRAM, "only the health URL and Telegram may be called");
    const body = JSON.parse(init.body);
    mock.messages.push(body);
    return mock.telegram(body);
  };
  t.after(() => { globalThis.fetch = original; });
  for (const level of ["log", "warn", "error"]) {
    t.mock.method(console, level, (...args) => { mock.logs.push(args.join(" ")); });
  }
  mock.run = minutes => worker.scheduled({ cron: "*/5 * * * *", scheduledTime: START + minutes * MINUTE }, env);
  mock.texts = () => mock.messages.map(message => message.text);
  return mock;
}

test("a healthy site sends nothing and writes no state", async t => {
  const mock = setup(t);
  for (const minute of [0, 5, 10]) await mock.run(minute);
  assert.deepEqual(mock.messages, []);
  assert.equal(mock.env.STATE.writes, 0);
});

test("the first failure is not an alert; the second consecutive failure is", async t => {
  const mock = setup(t);
  mock.health = proxyDown;
  await mock.run(0);
  assert.deepEqual(mock.messages, []);
  assert.equal(mock.env.STATE.writes, 1);

  await mock.run(5);
  assert.equal(mock.messages.length, 1);
  assert.equal(mock.messages[0].chat_id, "12345");
  assert.equal(mock.messages[0].text, [
    "🚨 스톡 인사이트 접속 장애",
    "원인: HTTP 503",
    "시작: 11/01 14:00 KST (5분째)",
    "홈서버 전원·Docker·Tailscale Funnel을 확인하세요.",
  ].join("\n"));

  await mock.run(10);
  assert.equal(mock.messages.length, 1, "no repeat while the reminder interval has not passed");
  assert.equal(mock.env.STATE.writes, 2);
});

test("a single failure followed by a healthy check stays silent and resets the count", async t => {
  const mock = setup(t);
  mock.health = proxyDown;
  await mock.run(0);
  mock.health = healthy;
  await mock.run(5);
  assert.equal(mock.env.STATE.data.size, 0);
  mock.health = proxyDown;
  await mock.run(10);
  assert.deepEqual(mock.messages, [], "failures separated by a success are not consecutive");
  await mock.run(15);
  assert.equal(mock.messages.length, 1);
  assert.match(mock.texts()[0], /시작: 11\/01 14:10 KST \(5분째\)/);
});

test("a continuing outage gets at most one reminder every 6 hours", async t => {
  const mock = setup(t);
  mock.health = () => { throw new TypeError("Network connection lost."); };
  for (let minute = 0; minute <= 360; minute += 5) await mock.run(minute);
  assert.equal(mock.messages.length, 1, "only the first alert within 6 hours of it");
  const writes = mock.env.STATE.writes;

  await mock.run(365);
  assert.equal(mock.messages.length, 2);
  assert.equal(mock.texts()[1], [
    "⏰ 스톡 인사이트 장애 계속",
    "원인: 연결 실패(TypeError)",
    "시작: 11/01 14:00 KST (6시간 5분째)",
    "홈서버 전원·Docker·Tailscale Funnel을 확인하세요.",
  ].join("\n"));
  assert.equal(mock.env.STATE.writes, writes + 1);

  for (let minute = 370; minute < 725; minute += 5) await mock.run(minute);
  assert.equal(mock.messages.length, 2);
  await mock.run(725);
  assert.equal(mock.messages.length, 3);
  assert.match(mock.texts()[2], /12시간 5분째/);
});

test("recovery needs two good checks, then sends one message with the downtime", async t => {
  const mock = setup(t);
  mock.health = proxyDown;
  for (let minute = 0; minute <= 80; minute += 5) await mock.run(minute);
  mock.health = healthy;
  await mock.run(85);
  assert.equal(mock.messages.length, 1, "one good check is not a recovery yet");
  await mock.run(90);
  assert.equal(mock.messages.length, 2);
  assert.equal(mock.texts()[1], "✅ 스톡 인사이트 복구\n장애 시간: 약 1시간 25분 (11/01 14:00 ~ 15:25 KST)");
  assert.equal(mock.env.STATE.data.size, 0);
  await mock.run(95);
  assert.equal(mock.messages.length, 2);
});

test("a flapping server keeps one outage instead of alert/recovery pairs", async t => {
  const mock = setup(t);
  mock.health = proxyDown;
  await mock.run(0);
  await mock.run(5);
  assert.equal(mock.messages.length, 1);
  for (let minute = 10; minute <= 120; minute += 15) {
    mock.health = healthy;
    await mock.run(minute);
    mock.health = proxyDown;
    await mock.run(minute + 5);
    await mock.run(minute + 10);
  }
  assert.equal(mock.messages.length, 1, "no recovery or new alert while it keeps failing again");
  assert.deepEqual(JSON.parse(mock.env.STATE.data.get("outage")), { since: START, notifiedAt: START + 5 * MINUTE });
});

test("a multi-day outage reports days in the recovery message", async t => {
  const mock = setup(t);
  mock.health = proxyDown;
  await mock.run(0);
  await mock.run(5);
  mock.health = healthy;
  await mock.run(26 * 60 + 30);
  await mock.run(26 * 60 + 35);
  assert.match(mock.texts().at(-1), /약 1일 2시간 30분 \(11\/01 14:00 ~ 11\/02 16:30 KST\)/);
});

test("missing secrets are logged and skipped, and the pending alert goes out once they are set", async t => {
  const mock = setup(t, { secrets: false });
  mock.health = proxyDown;
  for (const minute of [0, 5, 10]) await mock.run(minute);
  assert.deepEqual(mock.messages, []);
  assert.equal(mock.env.STATE.writes, 1, "no write per skipped run");
  assert.equal(mock.logs.filter(line => line.includes("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID")).length, 2);

  mock.env.TELEGRAM_BOT_TOKEN = TOKEN;
  await mock.run(15);
  assert.deepEqual(mock.messages, [], "a chat id is required as well");
  mock.env.TELEGRAM_CHAT_ID = "not a chat id";
  await mock.run(20);
  assert.deepEqual(mock.messages, [], "an invalid chat id counts as missing");

  mock.env.TELEGRAM_CHAT_ID = "12345";
  await mock.run(25);
  assert.equal(mock.messages.length, 1);
  assert.match(mock.texts()[0], /^🚨/);
  assert.match(mock.texts()[0], /\(25분째\)/);
});

test("an outage that was never delivered ends without a recovery message", async t => {
  const mock = setup(t, { secrets: false });
  mock.health = proxyDown;
  await mock.run(0);
  await mock.run(5);
  Object.assign(mock.env, { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "12345" });
  mock.health = healthy;
  await mock.run(10);
  assert.deepEqual(mock.messages, []);
  assert.equal(mock.env.STATE.data.size, 0);
});

test("HTML, non-JSON and unexpected bodies fail the check with their reason", async t => {
  const cases = [
    [() => new Response("<title>Error 1027</title>", {
      status: 503, headers: { "Content-Type": "text/html" },
    }), "HTTP 503"],
    [() => new Response("<!doctype html><title>스톡 인사이트</title>", {
      headers: { "Content-Type": "text/html" },
    }), "HTTP 200, JSON 아님"],
    [() => Response.json({ status: "starting" }), 'HTTP 200, status가 "ok" 아님'],
    [() => Response.json({ detail: "Not Found" }, { status: 404 }), "HTTP 404"],
  ];
  for (const [health, reason] of cases) {
    await t.test(reason, async t => {
      const mock = setup(t);
      mock.health = health;
      await mock.run(0);
      await mock.run(5);
      assert.equal(mock.messages.length, 1);
      assert.match(mock.texts()[0], new RegExp(`원인: ${reason}\n`));
    });
  }
});

test("a non-HTTPS HEALTH_URL is reported instead of being fetched", async t => {
  const mock = setup(t);
  mock.env.HEALTH_URL = "http://stock-insight-web.pages.dev/api/health";
  mock.health = () => assert.fail("an http URL must not be fetched");
  await mock.run(0);
  await mock.run(5);
  assert.match(mock.texts()[0], /원인: HEALTH_URL 설정 오류/);
});

test("a health check that hangs is aborted after 15 seconds", async t => {
  const mock = setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started;
  mock.health = init => new Promise((resolve, reject) => {
    started({ init, resolve });
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
  for (const minute of [0, 5]) {
    const request = new Promise(resolve => { started = resolve; });
    const run = mock.run(minute);
    const { init } = await request;
    t.mock.timers.tick(14_999);
    assert.equal(init.signal.aborted, false);
    t.mock.timers.tick(1);
    assert.equal(init.signal.aborted, true);
    await run;
  }
  assert.equal(mock.messages.length, 1);
  assert.match(mock.texts()[0], /원인: 응답 없음\(15초 초과\)/);
});

test("a check that answers in time clears its timer", async t => {
  const mock = setup(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  mock.health = init => { signal = init.signal; return healthy(); };
  await mock.run(0);
  t.mock.timers.tick(60_000);
  assert.equal(signal.aborted, false);
});

test("a failed Telegram delivery is retried next check without leaking the token", async t => {
  const mock = setup(t);
  mock.health = proxyDown;
  mock.telegram = () => { throw new TypeError(`fetch failed: ${TELEGRAM}`); };
  await mock.run(0);
  await mock.run(5);
  assert.equal(mock.env.STATE.writes, 1, "an undelivered alert is not recorded as sent");
  mock.telegram = () => Response.json({ ok: false, description: "Unauthorized" }, { status: 401 });
  await mock.run(10);
  assert.equal(mock.env.STATE.writes, 1);

  mock.telegram = () => Response.json({ ok: true });
  await mock.run(15);
  assert.equal(mock.messages.length, 3);
  assert.equal(mock.env.STATE.writes, 2);
  await mock.run(20);
  assert.equal(mock.messages.length, 3);

  const stored = [...mock.env.STATE.data.values()].join("");
  for (const text of [...mock.logs, ...mock.texts(), stored]) {
    assert.ok(!text.includes("fake-test-token"), text);
  }
  assert.ok(mock.logs.includes("Telegram sendMessage failed (TypeError)"));
  assert.ok(mock.logs.includes("Telegram sendMessage failed (HTTP 401)"));
});

test("comma-separated chat ids are each sent once, and one delivery is enough", async t => {
  const mock = setup(t);
  mock.env.TELEGRAM_CHAT_ID = "12345, -100987654321,12345";
  mock.health = proxyDown;
  mock.telegram = ({ chat_id }) => Response.json({ ok: chat_id === "12345" });
  await mock.run(0);
  await mock.run(5);
  assert.deepEqual(mock.messages.map(message => message.chat_id).sort(), ["-100987654321", "12345"]);
  await mock.run(10);
  assert.equal(mock.messages.length, 2, "delivered to one room, so not resent");
});

test("the Worker has no public fetch handler", () => {
  assert.equal(worker.fetch, undefined);
});
