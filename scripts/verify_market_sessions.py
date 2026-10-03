"""Built-app market-session regressions; isolated contexts, mocked APIs, and Playwright clock.

Run: python scripts/verify_market_sessions.py
"""
import asyncio
import json
from datetime import datetime, timedelta
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright, expect

BASE = 'http://127.0.0.1:8123'


async def scenario(browser, instant, quote_day):
    context = await browser.new_context(viewport={'width': 390, 'height': 900}, service_workers='block')
    requests, errors, blocked = [], [], []
    candles = [
        {'time': (datetime.fromisoformat(quote_day) - timedelta(days=1)).date().isoformat(), 'open': 100, 'high': 110, 'low': 90, 'close': 100, 'volume': 1000},
        {'time': quote_day, 'open': 100, 'high': 110, 'low': 90, 'close': 105, 'volume': 1100},
    ]

    async def mock(route):
        url = urlparse(route.request.url)
        if url.netloc != '127.0.0.1:8123':
            blocked.append(route.request.url)
            await route.abort()
            return
        if not url.path.startswith('/api/'):
            await route.continue_()
            return
        params = parse_qs(url.query)
        requests.append((url.path, params))
        status, payload = 200, {}
        if url.path == '/api/watchlist':
            payload = [{'ticker': ticker, 'candles': candles} for ticker in params['tickers'][0].split(',')]
        elif url.path == '/api/prices': payload = candles
        elif url.path == '/api/index': payload = {'name': params['name'][0], 'last': 105, 'change': 5, 'changePct': 5, 'series': candles, 'quoteAsOf': quote_day}
        elif url.path == '/api/fx': payload = {'usdkrw': 1300, 'change': 0, 'changePct': 0}
        elif url.path == '/api/macro': payload = {'usdkrw': {'last': 1300, 'change': 0, 'changePct': 0}, 'wti': {'last': 70, 'change': 0, 'changePct': 0}}
        elif url.path in ['/api/night-price', '/api/synth-price']: payload = {'available': False}
        elif url.path == '/api/calendar': payload = {'events': [], 'sources': [], 'fetchedAt': instant, 'timezone': 'Asia/Seoul'}
        elif url.path == '/api/indicators': payload = {'time': [], **{key: [] for key in ['rsi', 'macd', 'signal', 'hist', 'bb_upper', 'bb_lower', 'ma20', 'ma60']}}
        else: status = 503
        await route.fulfill(status=status, content_type='application/json', body=json.dumps(payload))

    await context.route('**/*', mock)
    page = await context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    target = datetime.fromisoformat(instant.replace('Z', '+00:00'))
    await page.clock.install(time=target - timedelta(minutes=1))
    await page.clock.pause_at(target)
    await page.goto(BASE)
    await page.wait_for_load_state('networkidle')
    await page.clock.run_for(1)
    await expect(page.locator('.session-item')).to_have_count(2)
    await expect(page.locator('.session-item').first).to_contain_text(quote_day[5:].replace('-', '.'))
    return context, page, requests, errors, blocked


async def check():
    async with async_playwright() as engine:
        browser = await engine.chromium.launch()

        context, page, requests, errors, blocked = await scenario(browser, '2026-10-09T14:00:00Z', '2026-10-08')
        await expect(page.locator('.session-item').first).to_contain_text('한국 휴장')
        await expect(page.locator('.session-item').nth(1)).to_contain_text('미국 장중')
        initial = [params['tickers'][0] for path, params in requests if path == '/api/watchlist']
        assert sorted(initial) == ['000660,005930,0193T0,KS11', 'IXIC,KORU,SOXL'], initial
        requests.clear()
        async with page.expect_request('**/api/watchlist?**'):
            await page.clock.run_for(61_000)
        after = [params['tickers'][0] for path, params in requests if path == '/api/watchlist']
        assert after == ['IXIC,KORU,SOXL'], after
        assert not errors, errors
        assert not any('ai-briefing' in path or 'portfolio-review' in path or 'related-insight' in path for path, _ in requests)
        print('PASS KR holiday + US open: two initial market batches, then only US batch refreshes after 60s')
        await context.close()

        context, page, requests, errors, blocked = await scenario(browser, '2026-11-27T17:58:30Z', '2026-11-27')
        await expect(page.locator('.session-item').nth(1)).to_contain_text('미국 장중 · 조기마감 예정')
        requests.clear()
        async with page.expect_request('**/api/watchlist?**'):
            await page.clock.run_for(60_000)
        assert [params['tickers'][0] for path, params in requests if path == '/api/watchlist'] == ['IXIC,KORU,SOXL']
        requests.clear()
        await page.clock.run_for(150_000)
        await expect(page.locator('.session-item').nth(1)).to_contain_text('미국 조기마감 · 11.27 종가')
        assert not [path for path, _ in requests if path in ['/api/watchlist', '/api/index', '/api/prices']], requests
        assert not errors, errors
        print('PASS early close: US refresh before 13:00 ET, no regular-market refresh after close, label updates')
        await context.close()

        context, page, requests, errors, blocked = await scenario(browser, '2027-01-04T02:00:00Z', '2027-01-04')
        await expect(page.locator('.session-item').first).to_have_text('한국 거래일 확인 필요 · 01.04 기준')
        requests.clear()
        await page.clock.run_for(61_000)
        assert not [path for path, _ in requests if path in ['/api/watchlist', '/api/index', '/api/prices']], requests
        assert not [path for path, params in requests if path == '/api/synth-price' and params.get('ticker') == ['0193T0']], requests
        await page.goto(BASE + '/#tab=tech&market=KR&ticker=005930')
        await page.reload()
        await page.wait_for_load_state('networkidle')
        await page.clock.run_for(1)
        await expect(page.locator('.stock-header')).to_contain_text('거래일 확인 필요 · 01.04 기준')
        await expect(page.locator('.stock-header')).not_to_contain_text('01.04 종가')
        assert not errors, errors
        print('PASS unknown KR year: home and stock header say 기준, regular-market and KR synthetic polling stop')
        await context.close()
        await browser.close()


asyncio.run(check())
