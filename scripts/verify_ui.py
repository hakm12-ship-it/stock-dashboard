"""Browser regression checks using isolated local storage and real local APIs.
Run: python scripts/verify_ui.py [http://localhost:5186]
Requires an available Python Playwright installation and Chromium.
"""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5186'
OUT = Path(os.environ.get('UI_OUT') or Path(__file__).resolve().parents[1] / 'artifacts' / 'renewal')
OUT.mkdir(parents=True, exist_ok=True)
results, errors = [], []

def check(name, fn):
    try:
        fn()
        results.append({'check': name, 'passed': True})
        print('PASS', name, flush=True)
    except Exception as e:
        results.append({'check': name, 'passed': False, 'error': str(e)[:1200]})
        print('FAIL', name, str(e)[:250], flush=True)

def no_overflow(page):
    value = page.evaluate('''() => ({viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth, dialog: [...document.querySelectorAll('dialog[open] .dialog-body')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth}))})''')
    assert value['page'] <= value['viewport'], value
    assert all(d['scroll'] <= d['client'] + 1 for d in value['dialog']), value

def close_sheet(page):
    if page.locator('dialog[open]').count():
        page.keyboard.press('Escape')
        expect(page.locator('dialog[open]')).to_have_count(0)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block', locale='ko-KR')
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until='domcontentloaded')
    expect(page.locator('.watchlist-row')).to_have_count(7, timeout=30000)
    # Wait for actual quotes, without asserting any changing financial value.
    expect(page.locator('.watchlist-row').first).not_to_contain_text('조회 중', timeout=60000)
    page.wait_for_function("() => [...document.querySelectorAll('.watchlist-row')].every(e=>!e.textContent.includes('조회 중'))", timeout=60000)
    page.evaluate('document.fonts.ready')
    for width in [360, 390, 768, 1280, 1440]:
        page.set_viewport_size({'width': width, 'height': 900 if width < 1000 else 1000})
        page.screenshot(path=str(OUT / f'home-{width}.png'), full_page=True)
        check(f'home width {width}', lambda: no_overflow(page))

    def filters():
        page.get_by_role('button', name='미국', exact=True).click()
        expect(page.locator('.watchlist-row')).to_have_count(3)
        page.get_by_role('textbox', name='관심종목 검색').fill('존재하지않는종목')
        expect(page.get_by_text('조건에 맞는 종목이 없습니다')).to_be_visible()
        page.get_by_role('button', name='필터 초기화').click()
        expect(page.locator('.watchlist-row')).to_have_count(7)
        page.get_by_role('combobox', name='전일 대비 정렬').select_option('gainers')
        page.get_by_role('button', name='순서 편집').click()
        expect(page.get_by_role('button', name='삼성전자 위로 이동')).to_be_disabled()
        page.get_by_role('button', name='삼성전자 아래로 이동').click()
        page.get_by_role('button', name='편집 완료').click()
        expect(page.locator('.watchlist-row').first).to_have_attribute('aria-label', 'SK하이닉스 분석 열기')
    check('market filters, empty result, sort and reorder', filters)

    def search():
        page.get_by_role('button', name='종목 추가', exact=True).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        page.get_by_role('textbox', name='종목명 또는 티커', exact=True).fill('카카오')
        expect(page.get_by_role('button', name='추가', exact=True).first).to_be_visible(timeout=60000)
        page.get_by_role('button', name='추가', exact=True).first.click()
        expect(page.get_by_role('button', name='추가됨').first).to_be_disabled()
        for _ in range(15):
            page.keyboard.press('Tab')
            assert page.evaluate("document.activeElement.closest('dialog') !== null"), page.evaluate("document.activeElement.outerHTML")
        page.screenshot(path=str(OUT / 'search-desktop.png'))
        close_sheet(page)
        expect(page.locator('.watchlist-row')).to_have_count(8)
        assert page.evaluate("document.activeElement.textContent.includes('종목 추가')")
    check('real symbol search, add, focus containment and Escape', search)
    close_sheet(page)

    def research():
        page.get_by_role('button', name='삼성전자 분석 열기', exact=True).click()
        expect(page).to_have_url(__import__('re').compile('tab=signal'))
        expect(page.locator('h1')).to_have_text('종합 분석')
        expect(page.get_by_role('button',name='신호 규칙 설정')).to_be_visible(timeout=60000)
        page.get_by_role('button',name='신호 규칙 설정').click()
        expect(page.get_by_role('dialog',name='신호 규칙 설정')).to_be_visible()
        page.get_by_role('button',name='RSI 2배',exact=True).click()
        page.get_by_role('button',name='적용',exact=True).click()
        assert json.loads(page.evaluate("localStorage.getItem('signalConfig-v1')"))['w']['rsi']==2
        for label, key in [('차트','tech'),('기업 가치','fund'),('관련 뉴스','news')]:
            page.get_by_role('navigation').get_by_role('button', name=label, exact=True).click()
            expect(page).to_have_url(__import__('re').compile(f'tab={key}'))
            expect(page.locator('h1')).to_have_text(label)
            expect(page.locator('.research-body [role="status"]')).to_have_count(0, timeout=60000)
            if key == 'tech': expect(page.locator('.research-body canvas').first).to_be_visible(timeout=60000)
            for width in [360,390,768,1280,1440]:
                page.set_viewport_size({'width': width,'height':900})
                check(f'{key} width {width}', lambda: no_overflow(page))
            page.screenshot(path=str(OUT / f'{key}-desktop.png'), full_page=True)
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('h1')).to_have_text('관련 뉴스')
        page.go_back()
        expect(page.locator('h1')).to_have_text('기업 가치')
        page.get_by_role('navigation').get_by_role('button', name='관심종목', exact=True).click()
    check('stock analysis, tabs, reload and browser back', research)

    def holdings():
        page.get_by_role('navigation').get_by_role('button', name='관심종목', exact=True).click()
        page.get_by_role('button', name='보유 관리', exact=True).click()
        page.get_by_label('보유 수량 (주)', exact=True).fill('-10')
        page.get_by_label('평균 매수가 (KRW)', exact=True).fill('100000')
        page.get_by_role('button', name='보유종목 저장', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('0보다 큰')
        assert page.evaluate("localStorage.getItem('holdings')") is None
        page.get_by_label('보유 수량 (주)', exact=True).fill('10')
        page.get_by_role('button', name='보유종목 저장', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('저장했습니다')
        assert len(json.loads(page.evaluate("localStorage.getItem('holdings')"))) == 1
        for width in [360,390,768,1280,1440]:
            page.set_viewport_size({'width':width,'height':900})
            check(f'holdings modal width {width}', lambda: no_overflow(page))
        page.get_by_role('button', name='백업에서 복원', exact=True).click()
        page.get_by_label('백업 JSON').fill('{"holdings":[{"qty":-1}]}')
        page.get_by_role('button', name='복원 내용 확인').click()
        expect(page.get_by_role('alert')).to_be_visible()
        assert len(json.loads(page.evaluate("localStorage.getItem('holdings')"))) == 1
        page.get_by_label('백업 JSON').fill('{"v":1,"holdings":[]}')
        page.get_by_role('button', name='복원 내용 확인').click()
        expect(page.get_by_text('다음 목록이 교체됩니다')).to_be_visible()
        assert len(json.loads(page.evaluate("localStorage.getItem('holdings')"))) == 1
        page.screenshot(path=str(OUT / 'restore-confirmation.png'))
        page.get_by_role('button', name='확인한 목록으로 교체').click()
        assert json.loads(page.evaluate("localStorage.getItem('holdings')")) == []
        close_sheet(page)
    check('holding validation, persistence and staged legacy restore', holdings)
    close_sheet(page)

    def journal():
        page.get_by_role('button', name='매매일지', exact=True).click()
        page.get_by_label('수량 (주)', exact=True).fill('2')
        page.get_by_label('1주당 가격 (KRW)', exact=True).fill('1000')
        page.get_by_role('button', name='기록하기').click()
        expect(page.get_by_role('status')).to_contain_text('저장했습니다')
        page.get_by_role('button', name='기록하기').click()
        assert len(json.loads(page.evaluate("localStorage.getItem('trades-v1')"))) == 1
        page.set_viewport_size({'width':360,'height':900})
        no_overflow(page)
        page.screenshot(path=str(OUT / 'journal-360.png'))
        page.once('dialog', lambda dialog: dialog.dismiss())
        page.get_by_role('button', name=__import__('re').compile('매매 기록 삭제')).click()
        assert len(json.loads(page.evaluate("localStorage.getItem('trades-v1')"))) == 1
        close_sheet(page)
        page.get_by_role('button', name='보유 관리', exact=True).click()
        with page.expect_download() as info:
            page.get_by_role('button', name='백업 파일 다운로드').click()
        payload=json.loads(Path(info.value.path()).read_text(encoding="utf-8"))
        assert len(payload['trades']) == 1 and payload['v'] == 2
        close_sheet(page)
    check('trade validation, duplicate prevention, delete cancel and full backup', journal)
    close_sheet(page)

    def comparison():
        page.get_by_role('button', name='비교', exact=True).click()
        expect(page.get_by_role('dialog', name='종목 비교')).to_be_visible()
        page.get_by_role('dialog', name='종목 비교').get_by_role('button', name='1개월', exact=True).click()
        no_overflow(page)
        page.screenshot(path=str(OUT / 'comparison-360.png'))
        close_sheet(page)
    check('comparison chart at 360px', comparison)
    close_sheet(page)

    def light():
        page.get_by_role('button', name='밝은 테마로 전환').click()
        assert page.locator('html').get_attribute('data-theme') == 'light'
        page.set_viewport_size({'width':1440,'height':1000})
        page.screenshot(path=str(OUT / 'home-light.png'), full_page=True)
        page.reload(wait_until='domcontentloaded')
        assert page.locator('html').get_attribute('data-theme') == 'light'
    check('light theme and persistence', light)
    check('no application JavaScript exceptions', lambda: (_ for _ in ()).throw(AssertionError(errors)) if errors else None)
    # Failure and long-data fixtures affect only this separate test browser context.
    failed = browser.new_context(viewport={'width':390,'height':844}, service_workers='block')
    failed.route('**/api/**', lambda route: route.fulfill(status=503, content_type='application/json', body='{"detail":"Test-only service unavailable"}'))
    fpage=failed.new_page()
    def unavailable():
        fpage.goto(BASE, wait_until='domcontentloaded')
        fpage.get_by_role('button', name='종목 추가', exact=True).click()
        fpage.get_by_label('종목명 또는 티커', exact=True).fill('삼성')
        expect(fpage.get_by_role('dialog').get_by_role('alert')).to_contain_text('검색 서버', timeout=20000)
        expect(fpage.get_by_text('검색 결과가 없어요', exact=True)).to_have_count(0)
        no_overflow(fpage)
        fpage.screenshot(path=str(OUT / 'search-failure.png'))
        close_sheet(fpage)
        expect(fpage.locator('.watchlist-row').first).to_contain_text('조회 실패', timeout=20000)
    check('503 response is distinguished from empty search and loading', unavailable)
    failed.close()
    long = browser.new_context(viewport={'width':360,'height':900}, service_workers='block')
    fixture=[{'ticker':f'QA{i:04}', 'name':'아주 긴 한국어 관심종목 이름과 ETF 설명 '*5, 'short':'아주 긴 한국어 관심종목 이름 '*5, 'market':'US','kind':'etf'} for i in range(60)]
    long.add_init_script('localStorage.setItem("customTickers", '+json.dumps(json.dumps(fixture))+')')
    long.route('**/api/**', lambda route: route.fulfill(status=503,content_type='application/json',body='{}'))
    lp=long.new_page()
    def long_list():
        lp.goto(BASE,wait_until='domcontentloaded')
        expect(lp.locator('.watchlist-row')).to_have_count(67)
        no_overflow(lp)
        lp.get_by_role('button', name='목록에서 찾기').click()
        lp.get_by_label('관심종목 검색').fill('QA0059')
        expect(lp.locator('.watchlist-row')).to_have_count(1)
        no_overflow(lp)
        lp.screenshot(path=str(OUT / 'long-name-360.png'))
    check('67 items and long Korean names at 360px', long_list)
    browser.close()

(OUT / 'ui-results.json').write_text(json.dumps({'base':BASE,'results':results,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{sum(r["passed"] for r in results)}/{len(results)} checks passed', flush=True)
sys.exit(0 if all(r['passed'] for r in results) else 1)
