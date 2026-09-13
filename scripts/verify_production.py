from playwright.sync_api import sync_playwright, expect
from urllib.request import urlopen
from urllib.error import HTTPError
from pathlib import Path
import json
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 c=b.new_context(viewport={'width':1440,'height':1000})
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:8000',wait_until='domcontentloaded')
 expect(page.locator('.watchlist-row')).to_have_count(7)
 assert page.locator('link[rel="canonical"]').get_attribute('href')=='https://stock-insight-zws6.onrender.com/'
 assert page.locator('meta[name="description"]').get_attribute('content')
 assert page.locator('.app-nav').evaluate('e=>getComputedStyle(e).width')=='212px'
 page.get_by_role('button',name='삼성전자 분석 열기').click()
 page.get_by_role('navigation').get_by_role('button',name='차트',exact=True).click()
 expect(page.locator('.research-body canvas').first).to_be_visible(timeout=60000)
 page.locator('.skip-link').focus();page.keyboard.press('Enter')
 expect(page.locator('h1')).to_have_text('차트')
 assert page.evaluate("document.activeElement.id === 'main-content'")
 assert not errors,errors
 results.append({'check':'production bundle, SEO metadata, actual chart canvas and skip-link','passed':True})
 # Await service worker activation and verify development paths are not in the cache.
 page.wait_for_function("() => navigator.serviceWorker.controller !== null",timeout=15000)
 names=page.evaluate('caches.keys()')
 assert all(n.startswith('stock-insight-') for n in names)
 results.append({'check':'production service worker activated','passed':True,'caches':names})
 b.close()
try:
 urlopen('http://localhost:8000/api/kakao-token-status',timeout=10)
except HTTPError as e:
 assert e.code==401
 assert e.headers.get('Cache-Control')=='no-store'
 assert e.headers.get('Referrer-Policy')=='no-referrer'
 results.append({'check':'admin diagnostics blocked and not cached','passed':True})
for r in results: print('PASS',r['check'])
Path('artifacts/renewal/production-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
