"""Isolated chart/backup regressions against Vite; every API response is mocked."""
import asyncio
import json
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright, expect

BASE = 'http://localhost:5186'


async def check():
    async with async_playwright() as engine:
        browser = await engine.chromium.launch()
        context = await browser.new_context(viewport={'width': 390, 'height': 900}, accept_downloads=True)
        candles = [{'time': (date(2026, 5, 1) + timedelta(days=i)).isoformat(), 'open': 100+i, 'high': 110+i, 'low': 90+i, 'close': 105+i, 'volume': 1000+i} for i in range(130)]
        state = {'indicator_failure': True}
        requests, errors = [], []

        async def mock(route):
            url = urlparse(route.request.url)
            params = parse_qs(url.query)
            requests.append(url.path)
            code, payload = 200, {}
            if url.path == '/api/prices': payload = candles
            elif url.path == '/api/indicators':
                if state['indicator_failure']: code = 503
                else: payload = {'time': [c['time'] for c in candles], **{key: [50] * len(candles) for key in ['rsi', 'macd', 'signal', 'hist', 'bb_upper', 'bb_lower', 'ma20', 'ma60']}}
            elif url.path == '/api/signal': code = 503
            elif url.path == '/api/fx': payload = {'usdkrw': 1300, 'change': 0, 'changePct': 0}
            elif url.path == '/api/fx-history': payload = [{'time': c['time'], 'rate': 1300} for c in candles]
            elif url.path == '/api/watchlist': payload = []
            elif url.path == '/api/index': payload = {'name': params.get('name', ['index'])[0], 'last': 100, 'change': 0, 'changePct': 0, 'series': []}
            elif url.path == '/api/macro': payload = {'usdkrw': {'last': 1300, 'change': 0, 'changePct': 0}, 'wti': {'last': 70, 'change': 0, 'changePct': 0}}
            elif url.path == '/api/calendar': payload = {'events': [], 'sources': [], 'fetchedAt': '2026-10-04T00:00:00Z', 'timezone': 'Asia/Seoul'}
            elif url.path == '/api/daily-report': payload = {'date': '2026-10-04', 'summary': '검증 데이터', 'tags': []}
            else: code = 503
            await route.fulfill(status=code, content_type='application/json', body=json.dumps(payload))

        await context.route('**/api/**', mock)
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(BASE + '/#tab=tech&market=KR&ticker=005930')
        await expect(page.get_by_text('차트 데이터를 불러오지 못했어요', exact=True)).to_be_visible(timeout=12000)
        requests.clear()
        await page.get_by_role('button', name='주봉', exact=True).click()
        await expect(page.get_by_role('img', name='가격·거래량 차트', exact=True)).to_be_visible()
        await expect(page.get_by_role('button', name='6개월', exact=True)).to_have_attribute('aria-pressed', 'true')
        await expect(page.get_by_role('img', name='RSI 차트', exact=True)).to_have_count(0)
        await page.evaluate("location.hash = 'tab=tech&market=US&ticker=SOXL'")
        await expect(page.get_by_role('button', name='주봉', exact=True)).to_have_attribute('aria-pressed', 'true')
        await expect(page.get_by_role('img', name='가격·거래량 차트', exact=True)).to_be_visible()
        assert '/api/indicators' not in requests and '/api/signal' not in requests, requests
        print('PASS weekly chart survives indicator failure, persists across tickers, and skips daily-only requests')

        state['indicator_failure'] = False
        await page.get_by_role('button', name='일봉', exact=True).click()
        await expect(page.get_by_role('img', name='RSI 차트', exact=True)).to_be_visible()
        for label in ['이동평균 20·60', '볼린저', '지지·저항']:
            await page.get_by_role('button', name=label, exact=True).click()
        await page.evaluate("location.hash = 'tab=tech&market=KR&ticker=005930'")
        await expect(page.get_by_role('button', name='이동평균 20·60', exact=True)).to_have_attribute('aria-pressed', 'false')
        await expect(page.get_by_role('button', name='볼린저', exact=True)).to_have_attribute('aria-pressed', 'true')
        await expect(page.get_by_role('button', name='지지·저항', exact=True)).to_have_attribute('aria-pressed', 'false')
        await page.get_by_role('button', name='주봉', exact=True).click()
        requests.clear()
        await page.reload()
        await expect(page.get_by_role('img', name='가격·거래량 차트', exact=True)).to_be_visible()
        await expect(page.get_by_role('button', name='6개월', exact=True)).to_have_attribute('aria-pressed', 'true')
        assert '/api/indicators' not in requests and '/api/signal' not in requests, requests
        print('PASS overlay choices and weekly minimum range survive remount/reload')

        await page.goto(BASE)
        await page.get_by_role('button', name='보유종목 등록하기', exact=True).click()
        await expect(page.get_by_text('마지막 다운로드 요청: 이력 없음', exact=True)).to_be_visible()
        await page.locator('#holding-ticker').select_option('KR-005930')
        await page.get_by_label('보유 수량 (주)', exact=True).fill('10')
        await page.get_by_label('평균 매수가', exact=False).fill('70000')
        await page.get_by_role('button', name='보유종목 저장', exact=True).click()
        await expect(page.get_by_role('heading', name='보유 1종목')).to_be_visible()
        async with page.expect_download() as download_info:
            await page.get_by_role('button', name='백업 파일 다운로드', exact=True).click()
        download = await download_info.value
        exported = json.loads(Path(await download.path()).read_text(encoding='utf-8'))
        assert exported['v'] == 2 and exported['holdings'][0]['qty'] == 10 and exported['trades'] == []
        await expect(page.get_by_text('마지막 백업 요청 이후 기록 변경이 없습니다.', exact=True)).to_be_visible()
        await expect(page.get_by_text('요청 이력은 파일 저장 완료를 뜻하지 않습니다.', exact=False)).to_be_visible()
        await expect(page.get_by_text('백업 파일 다운로드를 요청했습니다.', exact=False)).to_be_visible()

        second = await context.new_page()
        second.on('pageerror', lambda error: errors.append(str(error)))
        await second.goto(BASE)
        await second.get_by_role('button', name='보유 관리', exact=True).click()
        await second.get_by_role('button', name='삼성전자 수정', exact=True).click()
        await second.get_by_label('보유 수량 (주)', exact=True).fill('11')
        await second.get_by_role('button', name='보유 기록 수정', exact=True).click()
        for opened in [page, second]:
            await expect(opened.get_by_text('마지막 백업 요청 이후 기록이 변경되었습니다. 새 백업을 만들어 주세요.', exact=True)).to_be_visible()
        async with second.expect_download() as next_info:
            await second.get_by_role('button', name='백업 파일 다운로드', exact=True).click()
        next_download = await next_info.value
        assert json.loads(Path(await next_download.path()).read_text(encoding='utf-8'))['holdings'][0]['qty'] == 11
        await expect(page.get_by_text('마지막 백업 요청 이후 기록 변경이 없습니다.', exact=True)).to_be_visible()
        assert not errors, errors
        print('PASS v2 download content, honest request wording, changed-record notice, and two-tab history synchronization')
        await browser.close()


asyncio.run(check())
