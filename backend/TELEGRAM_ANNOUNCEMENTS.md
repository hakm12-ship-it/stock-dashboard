# 텔레그램 관리자 공지 설정

이 기능은 스톡 인사이트 봇과의 **1:1 대화**에서 아래 명령을 보내면 지정한
그룹으로 공지를 전달한다.

```text
/announce 오늘 장 마감 후 주요 경제지표 발표가 있습니다.
```

`/broadcast`와 `/공지`도 같은 용도로 쓸 수 있다. 공지는 항상 봇 이름으로
`📢 스톡 인사이트 공지` 제목과 함께 게시된다.

## Render 환경변수

Render 서비스의 Environment에 아래 값을 등록한다. 이미 쓰는
`TELEGRAM_BOT_TOKEN`은 그대로 재사용한다.

| 변수 | 값 |
| --- | --- |
| `TELEGRAM_ANNOUNCE_CHAT_ID` | 공지를 올릴 그룹의 chat_id. 일반 알림 수신자와 분리한다. |
| `TELEGRAM_ADMIN_USER_ID` | 공지를 보낼 수 있는 내 Telegram 숫자 user_id. |
| `TELEGRAM_WEBHOOK_SECRET` | 32자 이상 무작위 문자열. Telegram이 보내는 요청을 검증한다. |
| `APP_BASE_URL` | Render의 HTTPS 공개 주소. 예: `https://stock-insight-xxxx.onrender.com` |

`TELEGRAM_ANNOUNCE_CHAT_ID`에는 여러 ID를 넣지 않는다. 공지 전용 그룹 하나만
명시한다. 기존 `TELEGRAM_CHAT_ID`와 우연히 같은 값일 수는 있지만, 서로 다른
환경변수로 관리해 실수로 개인 알림 수신자에게 공지가 가는 것을 막는다.

## ID 확인

1. 봇과 1:1 대화를 열고 아무 메시지나 보낸다.
2. 로컬에서 `telegram_chat_id.py`를 실행해 내 개인 chat_id를 확인한다. 그 숫자가
   `TELEGRAM_ADMIN_USER_ID`다.
3. 그룹 ID는 기존 `TELEGRAM_CHAT_ID`에 쓰던 그룹 값이 있으면 그 값을 사용한다.

## 웹훅 등록

Render 배포가 끝난 뒤, 로컬 `backend/.env`에 위 환경변수들을 임시로 넣고 다음을
한 번 실행한다.

```powershell
cd C:\PJT\backend
..\stock-dashboard\.venv\Scripts\python.exe telegram_webhook_setup.py
```

도우미는 Telegram의 `setWebhook`을 호출해
`https://내앱주소/api/telegram/webhook`을 등록한다. 봇 토큰은 명령줄에 넣지
않아 PowerShell 기록에 남기지 않는다.

웹훅을 등록한 뒤에는 Telegram의 `getUpdates` 방식과 함께 사용할 수 없으므로,
관리자 ID는 웹훅 등록 전에 확인하는 편이 편하다.

## 보안 동작

- Telegram의 웹훅 비밀 헤더가 맞아야 요청을 처리한다.
- `TELEGRAM_ADMIN_USER_ID`와 일치하는 발신자만 허용한다.
- 봇과의 1:1 대화에서 보낸 명령만 허용한다. 그룹 대화·일반 사용자의 메시지는
  조용히 무시한다.
- 공지 대상 그룹 ID와 봇 토큰은 API 응답이나 프런트엔드에 노출하지 않는다.

## 동작 확인

명령을 보내면 봇이 **같은 1:1 대화로 결과를 회신**한다.

- `✅ 공지를 그룹에 올렸어요.` — 정상
- `❌ 공지 전송에 실패했어요.` — 봇이 그 그룹에 없거나 chat_id가 틀림
- `⚠️ 공지를 보낼 그룹이 설정돼 있지 않아요.` — `TELEGRAM_ANNOUNCE_CHAT_ID` 누락

회신이 아예 없으면 웹훅이 등록되지 않았거나 `TELEGRAM_WEBHOOK_SECRET`이
Render와 `setWebhook`에 준 값이 서로 다른 것이다.

Telegram은 웹훅 응답이 늦으면 같은 업데이트를 재전송하는데, 서버가
`update_id`로 걸러내므로 공지가 두 번 올라가지는 않는다. 사람이 같은 명령을
다시 보내는 것은 새 `update_id`라 정상적으로 다시 올라간다.
