"""Offline home improvements regression; all APIs mocked, no model calls or sends.
Run: python scripts/verify_home_improvements.py [http://127.0.0.1:8123]
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8123'
assert urlsplit(BASE).hostname in {'127.0.0.1', 'localhost'}
OUT = Path('.qa/home-improvements'); OUT.mkdir(parents=True, exist_ok=True)
NOW = datetime(2026, 10, 4, 4, 0, tzinfo=timezone.utc)
INIT = """
localStorage.setItem('customTickers', JSON.stringify([{ticker:'AAPL',name:'애플',short:'애플',market:'US',kind:'stock'}]));
localStorage.setItem('holdings', JSON.stringify([{ticker:'NVDA',name:'엔비디아',market:'US',kind:'stock',qty:2,avg:80}]));
"""
def candles(code):
    close = {'AAPL': 109, '005930': 104, '000660': 111, 'KORU': 106}.get(code, 101)
    return [{'time': day, 'open': value, 'high': value, 'low': value, 'close': value, 'volume': 1000}
            for day, value in [('2026-10-01', 100), ('2026-10-02', close)]]

def run(browser, width):
    context = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block', locale='ko-KR')
    context.add_init_script(INIT)
    requests, errors = [], []
    state = {'usage_error': False}
    def mock(route):
        url = urlsplit(route.request.url); args = parse_qs(url.query)
        if not url.path.startswith('/api/'):
            if url.hostname == urlsplit(BASE).hostname: route.continue_()
            else: route.abort()
            return
        requests.append((url.path, args))
        assert url.path not in ['/api/ai-briefing', '/api/related-insight'], 'Unexpected model API'
        if url.path == '/api/portfolio-review':
            assert args.get('comment') in [['0'], ['false']], 'Unexpected AI portfolio request'
        data, status = {}, 200
        if url.path == '/api/watchlist':
            data = [{'ticker': code, 'candles': candles(code), 'asOf': '2026-10-02', 'source': 'fixture', 'stale': code == '000660'} for code in args['tickers'][0].split(',')]
        elif url.path == '/api/prices': data = candles(args['ticker'][0])
        elif url.path == '/api/fx': data = {'usdkrw': 1300, 'change': 0, 'changePct': 0}
        elif url.path == '/api/fx-history': data = [{'time': '2026-10-02', 'rate': 1300}]
        elif url.path == '/api/index': data = {'name': args['name'][0], 'last': 100, 'change': 0, 'changePct': 0, 'series': [], 'quoteAsOf': '2026-10-02'}
        elif url.path == '/api/macro': data = {'usdkrw': {'last': 1300, 'change': 0, 'changePct': 0}, 'wti': {'last': 70, 'change': 0, 'changePct': 0}}
        elif url.path == '/api/calendar':
            data = {'events': [{'id': code, 'title': name+' 실적 발표', 'ticker': code, 'category': 'earnings', 'country': 'US', 'date': '2026-10-07', 'startAt': None, 'timeStatus': 'tentative', 'importance': 'high', 'source': 'IR', 'sourceUrl': 'https://example.com/ir'} for code,name in [('AAPL','애플'),('NVDA','엔비디아')]], 'sources': [{'name': 'IR', 'url': 'https://example.com/ir', 'status': 'ok'}], 'fetchedAt': '2026-10-04T12:00:00+09:00', 'timezone': 'Asia/Seoul'}
        elif url.path == '/api/public-briefing':
            data = {'available': True, 'status': 'ready', 'date': '2026-10-04', 'slot': 'noon', 'sources': [], 'items': [{'id':'a','title':'Apple reports earnings','url':'https://example.com/apple','source':'RSS','publishedAt':'2026-10-04T11:00:00+09:00','previousWindow':False}], 'generatedAt':'2026-10-04T13:00:00+09:00','windowStart':'2026-10-04T07:00:00+09:00','windowEnd':'2026-10-04T13:00:00+09:00','backfillCount':0,'message':'원문 확인'}
        elif url.path == '/api/usage-status':
            if state['usage_error']: status, data = 503, {'detail': 'fixture unavailable'}
            else: data = {'scope':'server_process','timezone':'Asia/Seoul','api':{'date':'2026-10-04','startedAt':'2026-10-04T09:00:00+09:00','requests':40,'httpErrors':1,'cacheHits':30,'cacheLoads':10,'cacheErrors':0,'cacheHitRate':75,'recentErrors':[]},'ai':{'date':'2026-10-04','configured':True,'limit':20,'attempts':3,'remaining':17,'cacheHits':6,'cachedResults':2,'inflight':0,'cooldownSeconds':600,'resetsOnRestart':True,'recentErrors':[{'kind':'briefing','reason':'quota_cooldown','at':'2026-10-04T10:00:00+09:00'}]}}
        elif url.path == '/api/daily-report': data = {'date':'2026-10-04','summary':'검증 데이터','tags':[]}
        elif url.path == '/api/groups': data = []
        elif url.path == '/api/market-top': data = []
        else: data = {'available': False}
        route.fulfill(status=status, json=data)
    context.route('**/*', mock)
    page = context.new_page(); page.clock.install(time=NOW)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    card = page.locator('.my-day-card')
    expect(card).to_contain_text('Apple reports earnings')
    expect(card).to_contain_text('애플 실적 발표')
    expect(card).to_contain_text('엔비디아 실적 발표')
    expect(card).to_contain_text('+9.00%')
    expect(card).not_to_contain_text('+11.00%')  # stale quotes must not become a headline.
    assert sum(path == '/api/prices' for path,_ in requests) == 1, requests
    assert not any(path in ['/api/news', '/api/usage-status'] for path,_ in requests)
    card.screenshot(path=str(OUT / f'my-day-{width}.png'))
    page.locator('.market-review summary').click()
    expect(page.locator('.market-review')).to_contain_text('2027년 거래일 갱신이 필요')
    expect(page.locator('.market-review')).to_contain_text('2026-11-19 한국 특별 거래시간')
    usage = page.locator('.usage-status')
    usage.get_by_role('button', name='호출량·운영 상태').click()
    expect(usage).to_contain_text('3 / 20회')
    expect(usage).to_contain_text('17회')
    expect(usage).to_contain_text('75%')
    expect(usage).to_contain_text('초기화됩니다')
    before = sum(path == '/api/usage-status' for path,_ in requests)
    page.clock.run_for(61_000)
    assert sum(path == '/api/usage-status' for path,_ in requests) == before
    state['usage_error'] = True
    usage.get_by_role('button', name='집계 다시 조회').click()
    expect(usage).to_contain_text('마지막 확인값을 표시')
    expect(usage).to_contain_text('17회')
    usage.screenshot(path=str(OUT / f'usage-{width}.png'))
    page.get_by_role('group', name='시장 필터').get_by_role('button', name='미국', exact=False).click()
    if not page.get_by_label('전일 대비 정렬').is_visible():
        page.get_by_role('button', name='보기 설정').click()
    page.get_by_label('전일 대비 정렬').select_option('losers')
    page.get_by_role('group', name='가격 흐름 기간').get_by_role('button', name='6개월', exact=True).click()
    page.reload()
    if not page.get_by_label('전일 대비 정렬').is_visible():
        page.get_by_role('button', name='보기 설정').click()
    expect(page.get_by_role('group', name='시장 필터').get_by_role('button', name='미국', exact=False)).to_have_attribute('aria-pressed','true')
    expect(page.get_by_label('전일 대비 정렬')).to_have_value('losers')
    expect(page.get_by_role('group', name='가격 흐름 기간').get_by_role('button', name='6개월', exact=True)).to_have_attribute('aria-pressed','true')
    # Another tab updates only preferences, preserving the account records.
    other = context.new_page(); other.clock.install(time=NOW); other.goto(BASE)
    other.get_by_role('group', name='시장 필터').get_by_role('button', name='한국', exact=False).click()
    expect(page.get_by_role('group', name='시장 필터').get_by_role('button', name='한국', exact=False)).to_have_attribute('aria-pressed','true')
    assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    assert not errors, errors
    context.close()
    return {'width':width,'passed':True,'extraNewsRequests':0,'usagePolls':0,'settingsReloadAndCrossTab':True,'pageErrors':errors}

with sync_playwright() as engine:
    browser = engine.chromium.launch()
    results = [run(browser, width) for width in [1280,390]]
    browser.close()
(OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(results, ensure_ascii=True))
