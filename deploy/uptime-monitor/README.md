# 공개 주소 장애 알림 (Cloudflare Worker)

Coolify는 앱과 같은 홈서버에서 돌기 때문에 서버 전원·Docker·Tailscale Funnel이
멈추면 알림을 보낼 수 없다. 2026-10-25 장애도 이 때문에 알아채지 못했다.
이 Worker는 홈서버 밖(Cloudflare)에서 5분마다 공개 주소를 확인하고, 장애가 나면
텔레그램으로 알린다. 앱·Pages 프록시·홈서버 설정은 바꾸지 않는다.

## 동작

- 5분마다 `HEALTH_URL`(기본 `https://stock-insight-web.pages.dev/api/health`)을
  15초 제한으로 GET 한다. **HTTP 200이고 JSON `{"status":"ok"}`일 때만 정상**이다.
  홈서버에 닿지 못할 때 Pages 프록시가 돌려주는 503(JSON), Cloudflare의 HTML 오류
  페이지, 200이지만 HTML인 응답, 시간 초과, 연결 실패는 모두 실패로 본다.
- 한 번의 실패는 기록만 한다. **2회 연속 실패하면** 🚨 알림을 보낸다
  (장애 시작 후 약 5~10분).
- 장애가 계속되면 마지막 알림 후 **6시간마다 한 번** ⏰ 알림을 보낸다.
- 알림을 보냈던 장애가 **2회 연속 정상**이면 ✅ 복구 메시지를 한 번 보낸다. 정상과
  실패가 번갈아 나오면 같은 장애로 이어 보고 알림을 반복하지 않는다. 장애 시간은 첫
  실패 확인부터 연속 정상의 첫 확인까지이므로 5분 단위의 근사치다.

```text
🚨 스톡 인사이트 접속 장애
원인: HTTP 503
시작: 11/01 14:00 KST (5분째)
홈서버 전원·Docker·Tailscale Funnel을 확인하세요.

✅ 스톡 인사이트 복구
장애 시간: 약 1시간 25분 (11/01 14:00 ~ 15:25 KST)
```

- 원인에는 HTTP 상태, 시간 초과, 오류 종류만 넣는다. 토큰·대화방 ID·응답 본문은
  메시지와 로그에 남기지 않는다.
- 장애 알림이 전달되지 않으면(시크릿 미설정·텔레그램 오류) 보낸 것으로 기록하지
  않고 다음 확인 때 다시 보낸다. 시크릿이 없으면 로그만 남기고 건너뛰며 예외로
  멈추지 않는다. 복구 메시지는 한 번만 시도한다.
- `TELEGRAM_CHAT_ID`는 앱과 같은 형식이다. 쉼표로 여러 대화방을 넣을 수 있고,
  한 곳이라도 받으면 전달된 것으로 본다. 운영자에게만 가는 알림이므로 **운영자 개인
  대화 ID만** 넣는다(앱의 `TELEGRAM_ADMIN_USER_ID` 값). 앱의 `TELEGRAM_CHAT_ID`에는
  그룹방이 섞여 있을 수 있으니 그대로 복사하지 않는다.
- 상태는 KV `STATE`의 키 하나(`outage`)에 둔다. 정상일 때는 키가 없고, 상태가
  바뀔 때와 알림을 보낼 때만 쓴다.

### 공개 주소(fetch 핸들러)를 두지 않는 이유

Worker로 들어오는 요청은 계정의 하루 100,000건 무료 한도에 포함되고, 이 한도를
사이트의 Pages 프록시와 함께 쓴다. 상태 조회 주소를 공개하면 누구나 호출해서
사이트의 한도와 KV 읽기를 소모할 수 있다. 동작은 텔레그램과 대시보드의 실행
로그로 충분히 확인할 수 있으므로 `workers_dev`·`preview_urls`를 끄고 주소를
만들지 않는다.

## 설정·배포

이 폴더(`deploy/uptime-monitor`)에서 실행한다. Cloudflare 계정 로그인이 필요하다
(`npx --yes wrangler@4.151.0 login`). 무료 플랜 그대로 쓰며 유료 기능은 켜지 않는다.

1. 상태 저장용 KV를 만든다.

   ```powershell
   npx --yes wrangler@4.151.0 kv namespace create stock-insight-uptime-state --update-config=false
   ```

   출력된 `id`만 복사해 `wrangler.jsonc`의 `REPLACE_WITH_KV_NAMESPACE_ID` 자리에
   넣는다. 바인딩 이름은 `STATE` 그대로 둔다. `kv namespace create STATE`로도
   만들 수 있지만 제목이 그대로 `STATE`가 되어 계정의 다른 프로젝트와 겹칠 수 있다.
   `--update-config=false`는 Wrangler가 설정 파일 전체를 다시 포맷하지 않게 한다.
   KV id는 비밀 값이 아니므로 커밋해도 된다.

2. 검증하고 배포한다. 출력에 `schedule: */5 * * * *`가 보이면 된다.

   ```powershell
   node --test monitor.test.mjs
   npx --yes wrangler@4.151.0 deploy
   ```

3. 텔레그램 시크릿 두 개를 등록한다. Worker가 생긴 뒤(배포 후)에 등록한다.

   ```powershell
   npx --yes wrangler@4.151.0 secret put TELEGRAM_BOT_TOKEN
   npx --yes wrangler@4.151.0 secret put TELEGRAM_CHAT_ID
   ```

   값은 명령줄 인자가 아니라 프롬프트에 붙여 넣는다(셸 기록에 남지 않는다).
   대시보드에서는 Workers & Pages → `stock-insight-uptime` → Settings →
   Variables and Secrets → Add에서 Type을 `Secret`으로 등록한다.
   봇 토큰은 Coolify의 `TELEGRAM_BOT_TOKEN`과 같은 값을 써도 된다. 대화방은 위의
   개인 대화 ID만 넣는다. 이 Worker는 `sendMessage`만
   호출하므로 앱의 웹훅과 충돌하지 않는다. 등록 전의 실행은
   `TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set` 로그만 남긴다.

`HEALTH_URL`은 `wrangler.jsonc`의 일반 변수다. 대시보드에서 바꾸면 다음
`wrangler deploy` 때 파일의 값으로 돌아간다. 중지하려면 `crons`를 `[]`로 바꿔
다시 배포한다. 앱·Pages·홈서버에는 영향이 없다.

## 테스트

1. 단위 테스트(네트워크를 쓰지 않는다). fetch·KV·시계를 흉내 내어 첫 실패 무알림,
   두 번째 실패 알림, 6시간 간격 알림, 복구 메시지와 장애 시간, 시크릿 미설정,
   HTML·JSON 503과 200 HTML, 15초 시간 초과, 텔레그램 실패 재시도, 토큰 비노출을
   검사한다.

   ```powershell
   node --test deploy/uptime-monitor/monitor.test.mjs
   ```

2. 로컬 실행. 실제 공개 주소를 한 번 확인하고 `health ok`를 출력한다. KV는 로컬
   모의 저장소라 운영 상태에 영향이 없고, 시크릿이 없으면 메시지는 건너뛴다.
   로컬 런타임이 지원하는 날짜가 더 이르면 compatibility date를 낮춰 실행한다는
   경고가 나오는데 무시해도 된다.

   ```powershell
   npx --yes wrangler@4.151.0 dev --test-scheduled
   # 다른 터미널에서
   curl.exe "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
   ```

   로컬에서 실제 발송까지 보려면 이 폴더의 `.dev.vars`에 두 시크릿을 넣는다.
   이 파일은 `.gitignore`로 커밋되지 않는다.

3. 배포 후 확인. 5분 안에 `health ok`가 보이면 된다. 대시보드의 해당 Worker
   Logs에서도 최근 3일의 실행 기록을 볼 수 있다.

   ```powershell
   npx --yes wrangler@4.151.0 tail stock-insight-uptime
   ```

4. 알림 경로 점검(선택, 실제 메시지가 나간다). 없는 주소로 잠시 배포해 🚨를 받고,
   원래 설정으로 다시 배포해 ✅를 받는다.

   ```powershell
   npx --yes wrangler@4.151.0 deploy --var HEALTH_URL:https://stock-insight-web.pages.dev/api/uptime-check-test
   # 약 10분 뒤 🚨(원인: HTTP 404) 수신을 확인한 다음
   npx --yes wrangler@4.151.0 deploy
   # 다음 확인(5분 이내)에 ✅ 수신
   ```

## 무료 한도 사용량

| 항목 | 이 Worker | 무료 한도 |
|---|---|---|
| Cron 실행 | 하루 288회 | Workers 요청 하루 100,000건(계정 공유, UTC 자정 초기화) |
| 상태 확인으로 실행되는 Pages Functions | 하루 288건 | 위 100,000건에 함께 포함 |
| CPU 시간 | 실행당 수 ms(응답 대기 시간 제외) | 실행당 10 ms |
| 하위 요청 | 실행당 1건 + 알림 시 대화방 수 | 실행당 50건 |
| KV 읽기 | 하루 288회 | 하루 100,000회 |
| KV 쓰기·삭제 | 평소 0회, 장애 1건당 4회 + 6시간마다 1회. 5분마다 정상·실패가 번갈아도 하루 288회 이하 | 각각 하루 1,000회(**계정 전체 공유**) |
| Cron Trigger | 1개 | 계정당 5개 |
| Workers Logs | 하루 약 300건 | 하루 200,000건, 3일 보관 |

사이트 프록시와 합쳐도 하루 요청 한도의 약 0.6%(576건)다. 텔레그램 Bot API는 무료다.

공식 안내: [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/),
[Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/),
[KV 한도](https://developers.cloudflare.com/kv/platform/limits/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## 감시 범위

- 공개 주소 → Pages 프록시 → Tailscale Funnel → 홈서버 → 앱 `/api/health`까지를
  한 번에 확인한다. 시세 데이터의 신선도나 앱의 알림 발송 여부는 보지 않는다.
- Cloudflare나 텔레그램 자체가 멈추면 이 알림도 오지 않는다.
- KV 쓰기 한도는 계정의 다른 프로젝트와 함께 쓴다. 다른 곳에서 한도를 다 쓰면 장애
  기록이 실패해 알림이 늦어질 수 있다.
- `observability.traces`는 켜지 않는다. 텔레그램 요청 주소 경로에 봇 토큰이 들어
  있어 트레이스에 남을 수 있다(지금의 Workers Logs는 요청 주소를 남기지 않는다).
