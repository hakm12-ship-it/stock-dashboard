# 홈서버 장중·야간 알림

기존 `/api/market-alert-check`, `/api/night-alert-check`를 홈서버의 systemd 타이머가
각각 1분마다 호출한다. 앱이 한국시간 장중·야간 조건과 중복 여부를 판단한다.
개인 대화·그룹 수신 대상은 Coolify의 기존 `TELEGRAM_CHAT_ID`를 사용한다.
07·12·18시 브리핑 및 경제 캘린더 알림은 별도의 설정이다.

2026-10-17 운영 확인: 개인 대화·그룹에 연결 테스트를 각 1회 발송했고,
두 타이머의 활성화·자동 실행과 HTTP 200 응답을 확인했다.

타이머는 Docker에서 실행 중인 해당 앱과 `127.0.0.1` 포트를 찾는다.
인증 키는 매번 컨테이너 런타임 환경에서 읽으며 파일이나 로그에 복사하지 않는다.
공개 도메인 변경과 Cloudflare 요청 한도의 영향을 받지 않는다.
호스트 전원·Docker·앱과 Telegram으로 나가는 인터넷 연결이 필요하다.

설치 전에 같은 엔드포인트를 호출하는 외부 cron과 기존 호스트 작업을 확인한다.
cron-job.org의 `stock`(8213708), `stock2`(8220351)는 비활성 상태로 유지한다.
중복 실행을 피하려면 이 타이머와 동시에 활성화하지 않는다.

호스트 배치 위치:

- `check_alert.py` → `/usr/local/libexec/stock-insight-alert-check` (0755)
- 서비스·타이머 템플릿 → `/etc/systemd/system/` (0644)
- `/etc/stock-insight-alerts.conf` (0644):

```ini
STOCK_INSIGHT_CONTAINER_PREFIX=stock-insight-l34j6ppyv7juqkzlzjzz0wuo-
```

위 설정 파일에는 공개 리소스 식별자만 있고 비밀 값은 없다.
Coolify 앱을 새 리소스로 만들면 이 접두사도 새 UUID로 바꾼다.

설치한 뒤 검증·시작한다:

```bash
systemd-analyze verify /etc/systemd/system/stock-insight-alert@.service /etc/systemd/system/stock-insight-alert@.timer
systemctl daemon-reload
systemctl enable --now stock-insight-alert@market.timer stock-insight-alert@night.timer
systemctl list-timers 'stock-insight-alert@*'
journalctl -u stock-insight-alert@market.service -u stock-insight-alert@night.service --since '10 minutes ago'
```

정상 실행은 HTTP 200과 종료 코드 0이다. 조건이 맞지 않으면 발송 없이 정상 종료한다.
타이머마다 한 번에 한 작업만 실행하고, 재부팅 후 누락된 검사를 몰아서 호출하지 않는다.
호출 실패는 journal에 비밀 값 없이 남고 다음 분에 다시 검사한다.
실제 테스트 메시지는 사용자 요청 시에만 보낸다.

중지·롤백 시 전용 타이머 두 개만 끈다:

```bash
systemctl disable --now stock-insight-alert@market.timer stock-insight-alert@night.timer
```

이 작업은 Coolify 앱·데이터 볼륨과 다른 홈서버 서비스를 제거하지 않는다.
