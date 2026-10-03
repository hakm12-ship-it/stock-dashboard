"""UI/UX regressions against the running app and real symbol API.

Run: python scripts/verify_uiux.py [http://localhost:5186]
Optional UI_OUT selects an artifact directory; existing renewal artifacts are untouched.
Each check uses an isolated browser context with empty local storage.
"""
import json
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5186'
OUT = Path(os.environ.get('UI_OUT') or Path(__file__).resolve().parents[1] / '.qa' / 'uiux-regression')
OUT.mkdir(parents=True, exist_ok=True)
results = []
expect.set_options(timeout=10000)


def no_overflow(page):
    dimensions = page.evaluate('''() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      dialogs: [...document.querySelectorAll('dialog[open] .dialog-body')].map(element => ({
        client: element.clientWidth, scroll: element.scrollWidth
      }))
    })''')
    assert dimensions['page'] <= dimensions['viewport'], dimensions
    assert all(row['scroll'] <= row['client'] + 1 for row in dimensions['dialogs']), dimensions


def home(page):
    expect(page.get_by_role('heading', name='나의 관심종목', exact=True)).to_be_visible()
    expect(page.locator('dialog[open]')).to_have_count(0)


def close_search(page, key='Escape'):
    if key == 'Escape':
        page.keyboard.press('Escape')
    else:
        page.go_back()
    expect(page.locator('dialog[open]')).to_have_count(0)
    page.wait_for_function('() => !history.state?.sheet')


def shortcut_and_history(page):
    initial_length = page.evaluate('history.length')
    initial_url = page.url
    page.keyboard.press('Control+k')
    expect(page.get_by_role('dialog', name='종목 검색')).to_be_visible()
    # Two animation frames allow React StrictMode effect replay to finish.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert page.evaluate('history.length') == initial_length + 1
    assert page.evaluate('typeof history.state?.sheet') == 'string'
    expect(page.get_by_role('textbox', name='종목명 또는 티커', exact=True)).to_be_focused()
    close_search(page)
    assert page.url == initial_url
    home(page)
    page.keyboard.press('Control+k')
    expect(page.get_by_role('dialog', name='종목 검색')).to_be_visible()
    close_search(page, key='Back')
    assert page.url == initial_url
    home(page)


def open_unregistered(page):
    page.get_by_role('button', name='종목 추가', exact=True).click()
    page.get_by_role('textbox', name='종목명 또는 티커', exact=True).fill('카카오')
    result = page.get_by_role('button', name='카카오 (035720) 분석 열기', exact=True)
    expect(result).to_be_visible(timeout=60000)
    expect(page.locator('#symbol-search-status')).to_contain_text('검색 결과')
    result.click()
    expect(page).to_have_url(re.compile(r'tab=signal.*ticker=035720'))
    expect(page.get_by_role('heading', name='종합 분석', exact=True)).to_be_visible()
    expect(page.locator('dialog[open]')).to_have_count(0)
    assert page.evaluate('localStorage.getItem("customTickers")') is None
    assert not page.evaluate('Boolean(history.state?.sheet)')
    page.go_back()
    home(page)
    expect(page.locator('.watchlist-row')).to_have_count(7)
    assert page.evaluate('localStorage.getItem("customTickers")') is None


def clear_and_debounce(page):
    page.get_by_role('button', name='종목 추가', exact=True).click()
    search = page.get_by_role('textbox', name='종목명 또는 티커', exact=True)
    search.fill('카카오')
    old_result = page.get_by_role('button', name='카카오 (035720) 분석 열기', exact=True)
    expect(old_result).to_be_visible(timeout=60000)
    search.fill('삼성')
    # Read immediately, while the 250 ms debounce is pending.
    assert old_result.count() == 0, 'Previous query result remained actionable during debounce'
    page.get_by_role('button', name='검색어 지우기', exact=True).click()
    expect(search).to_have_value('')
    expect(search).to_be_focused()
    expect(page.locator('ul[aria-label="검색 결과"]')).to_have_count(0)
    expect(page.locator('#symbol-search-status')).to_have_text('종목명 또는 티커를 입력해 주세요.')
    assert page.get_by_role('button', name='검색어 지우기', exact=True).count() == 0
    no_overflow(page)
    close_search(page)


def preserve_watchlist(page):
    section = page.locator('.watchlist-section')
    section.get_by_role('button', name='한국', exact=True).click()
    section.get_by_role('combobox', name='전일 대비 정렬').select_option('gainers')
    section.get_by_role('button', name='6개월', exact=True).click()
    section.get_by_role('textbox', name='관심종목 검색', exact=True).fill('삼성')
    row = section.get_by_role('button', name='삼성전자 분석 열기', exact=True)
    expect(row).to_be_visible()
    expect(page.locator('.watchlist-row')).to_have_count(1)
    page.evaluate('''() => {
      const row = document.querySelector('.watchlist-row');
      window.scrollTo(0, window.scrollY + row.getBoundingClientRect().top - 260);
    }''')
    scroll_before = page.evaluate('window.scrollY')
    assert scroll_before > 100, scroll_before
    row.click()
    expect(page.get_by_role('heading', name='종합 분석', exact=True)).to_be_visible()
    page.wait_for_function('() => window.scrollY === 0')
    page.go_back()
    home(page)
    expect(section.get_by_role('button', name='한국', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(section.get_by_role('combobox', name='전일 대비 정렬')).to_have_value('gainers')
    expect(section.get_by_role('button', name='6개월', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(section.get_by_role('textbox', name='관심종목 검색', exact=True)).to_have_value('삼성')
    expect(page.locator('.watchlist-row')).to_have_count(1)
    page.wait_for_function('(value) => Math.abs(window.scrollY - value) <= 2', arg=scroll_before)
    assert abs(page.evaluate('window.scrollY') - scroll_before) <= 2


def mobile_controls(page):
    section = page.locator('.watchlist-section')
    toggle = section.get_by_role('button', name='보기 설정', exact=True)
    controls = page.locator('#watchlist-view-options')
    expect(toggle).to_have_attribute('aria-expanded', 'false')
    expect(controls).to_be_hidden()
    toggle.click()
    expect(toggle).to_have_attribute('aria-expanded', 'true')
    expect(controls).to_be_visible()
    section.get_by_role('button', name='3개월', exact=True).click()
    section.get_by_role('combobox', name='전일 대비 정렬').select_option('losers')
    toggle.click()
    expect(controls).to_be_hidden()
    section.get_by_role('button', name='미국', exact=True).click()
    expect(page.locator('.watchlist-row')).to_have_count(3)
    section.get_by_role('button', name='목록에서 찾기', exact=True).click()
    search = section.get_by_role('textbox', name='관심종목 검색', exact=True)
    expect(search).to_be_focused()
    search.fill('SOXL')
    expect(page.locator('.watchlist-row')).to_have_count(1)
    expect(section.get_by_role('status')).to_contain_text('미국 1개 종목')
    section.get_by_role('button', name='목록 검색어 지우기', exact=True).click()
    expect(search).to_have_value('')
    expect(search).to_be_focused()
    expect(page.locator('.watchlist-row')).to_have_count(3)
    section.get_by_role('button', name='필터 초기화', exact=True).click()
    expect(page.locator('.watchlist-row')).to_have_count(7)
    expect(section.get_by_role('button', name='전체', exact=True)).to_have_attribute('aria-pressed', 'true')
    toggle.click()
    expect(section.get_by_role('button', name='3개월', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(section.get_by_role('combobox', name='전일 대비 정렬')).to_have_value('losers')
    no_overflow(page)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    cases = [
        ('search shortcut, one StrictMode history entry, Escape and browser back', shortcut_and_history, 1440),
        ('search opens unregistered stock and one back returns home', open_unregistered, 1440),
        ('search clears immediately and hides previous debounce results', clear_and_debounce, 390),
        ('watchlist preserves market, query, sort, period and scroll on return', preserve_watchlist, 1440),
        ('mobile view settings, market filter and clear at 390px', mobile_controls, 390),
        ('mobile view settings, market filter and clear at 360px', mobile_controls, 360),
    ]
    for index, (name, run, width) in enumerate(cases, start=1):
        context = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block', locale='ko-KR')
        page = context.new_page()
        page.set_default_timeout(15000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        result = {'check': name, 'width': width, 'passed': False}
        try:
            page.goto(BASE, wait_until='domcontentloaded')
            expect(page.locator('.watchlist-row')).to_have_count(7, timeout=30000)
            run(page)
            assert not errors, errors
            result['passed'] = True
            print('PASS', name, flush=True)
        except Exception as error:
            result['error'] = str(error)[:2500]
            result['activeElement'] = page.evaluate('document.activeElement?.outerHTML')
            print('FAIL', name, str(error)[:400], flush=True)
        finally:
            result['pageErrors'] = errors
            page.screenshot(path=str(OUT / f'uiux-{index}-{width}.png'), full_page=True)
            results.append(result)
            context.close()
    browser.close()

(OUT / 'uiux-results.json').write_text(json.dumps({'base': BASE, 'results': results}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{sum(result["passed"] for result in results)}/{len(results)} checks passed', flush=True)
sys.exit(0 if all(result['passed'] for result in results) else 1)
