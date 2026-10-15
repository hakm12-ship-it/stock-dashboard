# Cloudflare Pages의 무료 접속 주소

이 폴더는 Pages 주소에서 기존 홈서버 앱으로 요청을 전달하는 프록시다.
앱·시세 수집·AI 키·데이터 볼륨은 Coolify에 그대로 둔다. 임의의 목적지 URL을
받지 않으며, API의 인증 헤더·POST 본문·오류 상태를 유지한다.

## 비용과 주소

- Cloudflare Pages 프로젝트를 **무료 플랜**으로 생성한다. 유료 Workers 플랜이나
  유료 부가 기능은 활성화하지 않는다.
- 요청은 Pages Functions 무료 한도에 포함된다. 계정의 다른 Workers·Functions와
  합쳐 하루 100,000건이며 UTC 자정에 초기화된다.
- `hakm-stock.pages.dev`는 우선 후보 이름이다. 최종 주소는 프로젝트 생성 결과로
  확인한다. 이름이 사용 중이면 Cloudflare가 다른 접미사를 붙일 수 있다.
- 현재 Funnel 주소는 계속 사용 가능하다. 공개 주소 연결을 위해 서버·DB·볼륨을
  이동하거나 공유기의 포트 포워딩을 바꾸지 않는다.

공식 안내: [Pages 무료 한도](https://developers.cloudflare.com/pages/functions/pricing/),
[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## 배포

1. `node --test deploy/cloudflare-pages/proxy.test.mjs`로 검증한다.
2. `public`의 `_worker.js`·`_routes.json`·`index.html` 세 파일을 ZIP 최상위에 넣는다.
3. Cloudflare 대시보드에서 Pages 프로젝트를 생성하고 ZIP을 Direct Upload한다.
   `_worker.js`는 대시보드 업로드에서도 지원된다.
4. 발급된 실제 origin을 Pages의 `PUBLIC_SITE_URL`에 지정한다.
   `UPSTREAM_ORIGIN`은 기존 Funnel의 HTTPS origin으로 설정한다.
   `wrangler.jsonc`와 `_worker.js`의 기본 주소도 실제 발급 주소와 맞춘다.
5. 새 주소의 앱·API가 정상 동작하는지 확인한 뒤 Coolify의 `PUBLIC_SITE_URL`과
   `APP_BASE_URL`을 새 origin으로 저장하고 해당 앱만 다시 배포한다.

Wrangler를 쓰는 경우 이 폴더에서 아래 명령을 실행한다. 대시보드 업로드와 별도로
CLI의 사용자 인증이 필요하다.

```powershell
npx --yes wrangler@4.151.0 pages deploy public --project-name hakm-stock --branch main
```

프록시에는 Gemini·관리자·알림 키를 넣지 않는다. 업스트림 연결 실패는 검색 제외된
503 응답으로 처리한다. 미리보기 호스트는 `noindex, nofollow`와 전체 검색 제외
robots.txt를 반환한다.

## 실제 공개 주소에서 확인할 항목

- 홈·캘린더·JS·CSS의 200 응답과 브라우저 시세·차트 표시.
- canonical·OG URL·robots.txt의 Sitemap 주소·sitemap.xml이 실제 새 origin을 가리킴.
- `/api/health`의 정상 응답, 관리 API의 인증 없는 401 응답과 검색 제외 헤더.
- Google Search Console·네이버 Search Advisor의 소유권 확인·사이트맵 제출은
  사용자 계정에서 수행한다. 배포 검증은 실제 검색 색인 완료를 뜻하지 않는다.

관심종목·보유 기록·매매일지는 브라우저 origin별로 저장된다. 옮길 기록이 있으면
기존 주소에서 앱 백업을 내려받아 새 주소에서 복원한다.
