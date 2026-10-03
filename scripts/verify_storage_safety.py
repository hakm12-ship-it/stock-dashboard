"""Isolated-browser regressions. Every API is mocked; no real account/browser data is read.

Run against Vite with a Python that has Playwright: python scripts/verify_storage_safety.py
"""
import asyncio
import json
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright, expect

BASE = 'http://localhost:5186'


async def check(fallback=False):
    async with async_playwright() as engine:
        browser = await engine.chromium.launch()
        context = await browser.new_context(viewport={'width': 390, 'height': 900})
        if fallback:
            await context.add_init_script("Object.defineProperty(navigator, 'locks', {value: undefined})")
        state = {'prices_fail': False}
        async def mock(route):
            url = urlparse(route.request.url)
            params = parse_qs(url.query)
            payload = None
            code = 200
            if url.path == '/api/prices':
                if state['prices_fail']: code, payload = 503, {}
                else: payload = [{'time': '2026-10-01', 'open': 100, 'high': 110, 'low': 90, 'close': 100, 'volume': 100}, {'time': '2026-10-02', 'open': 110, 'high': 120, 'low': 100, 'close': 110, 'volume': 100}]
            elif url.path == '/api/fx': payload = {'usdkrw': 1300, 'change': 0, 'changePct': 0}
            elif url.path == '/api/fx-history': payload = [{'time': '2026-10-01', 'rate': 1300}, {'time': '2026-10-02', 'rate': 1300}]
            elif url.path == '/api/watchlist': payload = []
            elif url.path == '/api/index': payload = {'name': params.get('name', ['index'])[0], 'last': 100, 'change': 0, 'changePct': 0, 'series': []}
            elif url.path == '/api/macro': payload = {'usdkrw': {'last': 1300, 'change': 0, 'changePct': 0}, 'wti': {'last': 70, 'change': 0, 'changePct': 0}}
            elif url.path == '/api/calendar': payload = {'events': [], 'sources': [], 'fetchedAt': '2026-10-04T00:00:00Z', 'timezone': 'Asia/Seoul'}
            elif url.path == '/api/daily-report': payload = {'date': '2026-10-04', 'summary': '검증 데이터', 'tags': []}
            elif url.path in ['/api/alert-invite', '/api/portfolio-review']: payload = {'available': False}
            else: code, payload = 503, {}
            await route.fulfill(status=code, content_type='application/json', body=json.dumps(payload))
        await context.route('**/api/**', mock)
        pages = [await context.new_page(), await context.new_page()]
        errors = []
        for page in pages:
            page.on('pageerror', lambda error: errors.append(str(error)))
        await asyncio.gather(*(page.goto(BASE) for page in pages))
        for page, ticker in zip(pages, ['KR-005930', 'US-SOXL']):
            await page.get_by_role('button', name='보유종목 등록하기', exact=True).click()
            await page.locator('#holding-ticker').select_option(ticker)
            await page.get_by_label('보유 수량 (주)', exact=True).fill('10')
            await page.get_by_label('평균 매수가', exact=False).fill('100')
        await asyncio.gather(*(page.get_by_role('button', name='보유종목 저장', exact=True).click() for page in pages))
        for page in pages:
            await expect(page.get_by_role('heading', name='보유 2종목')).to_be_visible()
        saved = await pages[0].evaluate("JSON.parse(localStorage.getItem('holdings'))")
        assert sorted(item['ticker'] for item in saved) == ['005930', 'SOXL'], saved
        for page in pages:
            await page.locator('.dialog-header').get_by_role('button', name='닫기', exact=True).click()
            await expect(page.locator('dialog[open]')).to_have_count(0)
        print('PASS concurrent form saves and UI synchronization', 'IndexedDB' if fallback else 'Web Locks')

        # Concurrent mutations exercise the real Vite modules in two browsing contexts.
        script = '''async (ticker) => {
          const {mutateList} = await import('/src/lib/storage.ts');
          const {isTicker} = await import('/src/lib/validation.ts');
          return mutateList('customTickers', isTicker, latest => [...latest, {ticker, name:ticker, short:ticker, market:'US', kind:'stock'}]);
        }'''
        results = await asyncio.gather(pages[0].evaluate(script, 'TESTA'), pages[1].evaluate(script, 'TESTB'))
        assert all(result['ok'] for result in results)
        saved_custom = await pages[0].evaluate("JSON.parse(localStorage.getItem('customTickers'))")
        assert len(saved_custom) == 2, saved_custom
        print('PASS concurrent watchlist additions')

        if not fallback:
            page = pages[0]
            await page.get_by_role('button', name='매매일지', exact=True).click()
            await expect(page.get_by_role('dialog', name='매매일지', exact=True)).to_be_visible()
            await page.locator('dialog select').first.select_option('US-SOXL')
            await page.get_by_role('button', name='매도', exact=True).click()
            await page.get_by_label('수량 (주)', exact=True).fill('10')
            await page.get_by_label('1주당 가격', exact=False).fill('150')
            await page.get_by_label('매매 날짜', exact=True).fill('2026-10-01')
            await page.get_by_label('같은 날 실제 거래 순서').fill('2')
            await page.get_by_role('button', name='기록하기', exact=True).click()
            await expect(page.get_by_text('계산 보류', exact=True)).to_be_visible()
            await page.get_by_role('button', name='매수', exact=True).click()
            await page.get_by_label('수량 (주)', exact=True).fill('10')
            await page.get_by_label('1주당 가격', exact=False).fill('100')
            await page.get_by_label('같은 날 실제 거래 순서').fill('1')
            await page.get_by_role('button', name='기록하기', exact=True).click()
            await expect(page.get_by_text('+$500.00', exact=True)).to_be_visible()
            await expect(page.get_by_text('보유 수량은 자동으로 바뀌지 않습니다.', exact=False)).to_be_visible()
            await page.get_by_role('button', name='매매 기록 수정', exact=False).first.click()
            await expect(page.get_by_role('button', name='수정 저장', exact=True)).to_be_visible()
            await page.get_by_role('button', name='수정 취소', exact=True).click()
            await page.get_by_role('button', name='닫기', exact=True).click()
            await expect(page.locator('dialog[open]')).to_have_count(0)
            state['prices_fail'] = True
            await page.get_by_role('button', name='새로고침', exact=True).click()
            await expect(page.get_by_text('일부 항목을 새로고침하지 못했습니다.', exact=False)).to_be_visible(timeout=15000)
            await expect(page.get_by_text('시세·환율 갱신에 실패해 마지막 조회값으로 평가한 금액입니다.', exact=True)).to_be_visible()
            assert not await page.locator('.session-notice').filter(has_text='새로고침').count()
            print('PASS sell-first entry corrected by execution order, record editing, failed refresh labeling')
        assert not errors, errors
        await browser.close()


asyncio.run(check())
asyncio.run(check(fallback=True))
