# 경제 캘린더와 텔레그램 정기 알림

공개 캘린더는 `/calendar`, 데이터는 `/api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`에서 제공한다(최대 93일). 금리·경제지표는 공식 기관, 빅테크 실적은 Yahoo Finance의 예상 날짜를 사용한다. 확정 시각은 한국시간으로 변환하고, 시각 없는 미국 일정은 현지 날짜로 구분한다. 출처가 실패하면 빈 일정과 구분해서 표시한다.

## 발송 정책

- 한국시간 07:00, 12:00, 18:00 최신 경제·주식 브리핑.
- 18:00 다음 날 일정 예고. 확정된 중요 발표만 1시간 전 알림.
- RSS 제목 기반 요약이며 원문 링크·출처·발행시각 포함. Gemini 미설정/실패 시 출처별 헤드라인으로 제공한다.
- 10분 이내 도착한 실행만 허용한다. 오래 지연된 브리핑을 뒤늦게 몰아서 보내지 않는다.
- Telegram 요청 전에 SQLite에 발송권을 기록한다. 응답 시간 초과처럼 성공 여부가 불명확한 경우 자동 재전송하지 않는다. 중복 방지를 우선하므로 장애 중 일부 메시지는 누락될 수 있다.

## 호출 제한

- 24시간 GitHub keepalive 일정 제거. 기존 외부 cron-job.org health/알림 일정도 별도로 확인해야 한다. HTTP 오류 응답도 서버를 깨우므로 백엔드에서 거절하는 것만으로 실행 시간을 절약할 수 없다.
- 무료 Render의 750시간은 워크스페이스 내 모든 무료 웹 서비스가 공유한다. 사용하지 않을 때 잠들도록 두어야 한다. 다른 서비스의 사용량에 따라 다시 한도에 도달할 수 있다.
- 서버 시작 때 전체 한국·미국 종목 목록을 미리 수집하지 않는다(`PREWARM_SYMBOLS=false` 기본값).
- 화면의 분 단위 자동 갱신은 활성 시세 쿼리에 한정한다. 뉴스·기업정보·경제 캘린더는 개별 캐시를 사용한다.
- 캘린더 소스별 성공 6시간, 일반 실패 15분, HTTP 403/429는 1시간 대기. 날짜 범위가 달라도 소스 캐시를 공유한다.
- 브리핑은 날짜·시간대별 1회 생성 결과를 재사용한다. 영속 SQLite 설정 시 재시작과 여러 프로세스에서도 Gemini 최대 하루 3회 시도를 유지한다. 전체 RSS 실패는 30분 대기하므로 실패한 회차는 건너뛴다.

## 운영 연결

현재 `render.yaml`은 무료 요금제를 유지하며 자동 발송 스케줄러는 기본 꺼짐이다. 코드 배포만으로 상시 실행이나 유료 자원을 만들지 않는다.

정시 알림을 안정적으로 운영할 구성은 기존 stock-insight 서비스의 상시 실행 인스턴스와 1GB 영속 디스크다. 디스크 마운트는 `/var/data`, SQLite 파일은 `/var/data/notifications.sqlite3`로 한다. 무료 서비스에는 영속 디스크를 붙일 수 없다. 사용자가 비용을 승인한 뒤 설정한다.

| 환경변수 | 값/용도 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 기존 봇 토큰, 비밀 값 |
| `TELEGRAM_BRIEFING_CHAT_ID` | 전달할 방 한 곳의 chat_id. 미설정 시 공지용 `TELEGRAM_ANNOUNCE_CHAT_ID` 사용 |
| `ALERT_CHECK_KEY` | 외부 관리자 API 인증 키. 미설정 시 `ADMIN_KEY` 사용 |
| `NOTIFICATION_STATE_PATH` | 실제 영속 디스크 내부 절대 경로 |
| `NOTIFICATIONS_ENABLED` | `false`(기본). 운영 연결 후 명시적으로 `true`일 때만 발송 |
| `NOTIFICATION_INTERNAL_SCHEDULER_ENABLED` | 상시 실행/영속 저장소 확인 후에만 `true` |
| `NOTIFICATION_SCHEDULER_ACTIVE` | 외부 스케줄러 운영 확인용. 내부 스케줄러에서는 설정하지 않음 |
| `GEMINI_API_KEY` | 선택. 없으면 링크 포함 헤드라인 브리핑 |

내부 스케줄러는 서버 내부에서 5분 경계에 실행한다. 서버를 깨우는 외부 HTTP ping은 사용하지 않는다. 무료 서버가 잠들면 내부 스케줄러도 멈추므로 무료 환경에서 이것만 켜고 정시 발송이 된다고 안내해서는 안 된다. 기존 외부 시세 급변 알림은 별도 기능이므로 외부 일정을 변경할 때 함께 점검한다.

`GET /api/calendar/notification-status`의 `ready`와 `schedulerActive`를 모두 확인한다. 이 응답에는 봇 토큰·방 ID·디스크 경로가 노출되지 않는다. 실제 전송 전에는 Bearer 인증으로 `POST /api/calendar/notification-check?dry_run=true`를 호출해 예고 내용을 확인한다. 실제 발송은 `dry_run=false`를 명시해야 한다.

## 확인

```powershell
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests
```

운영에서 `/calendar` 200, canonical·description·sitemap·robots와 비공개 API의 `X-Robots-Tag: noindex, nofollow`를 검증한다. 검색엔진 노출 준비와 실제 색인은 다르며 Google Search Console/Naver Search Advisor 등록은 사이트 소유자 계정이 필요하다. Render 무료 서버는 잠들었을 때 자체 robots 차단 응답을 줄 수 있다는 플랫폼 제한도 있다.

참고: [Render 무료 한도](https://render.com/docs/free), [영속 디스크](https://render.com/docs/disks).
