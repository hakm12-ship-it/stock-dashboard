"""Compare HEAD and working tree UI using identical captured public API responses.
Before Vite server: from .qa/before/frontend run node node_modules/vite/bin/vite.js --port 5188 --strictPort
"""
from pathlib import Path
from urllib.parse import urlsplit
import json
from playwright.sync_api import sync_playwright
out=Path('artifacts/renewal'); cache={}
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 for name,port in [('before',5188),('after',5186)]:
  ctx=b.new_context(viewport={'width':1440,'height':1000}, service_workers='block',locale='ko-KR')
  ctx.add_init_script("localStorage.setItem('onboarded-v1','1'); localStorage.setItem('theme','dark')")
  def serve(route):
   u=urlsplit(route.request.url); key=u.path+'?'+u.query
   if key not in cache:
    try:
     response=route.fetch(timeout=60000)
     cache[key]={'status':response.status,'body':response.body(),'content_type':response.headers.get('content-type','application/json')}
    except Exception:
     cache[key]={'status':503,'body':b'{}','content_type':'application/json'}
   route.fulfill(**cache[key])
  ctx.route('**/api/**',serve)
  page=ctx.new_page(); page.goto(f'http://localhost:{port}',wait_until='networkidle',timeout=90000)
  page.evaluate('document.fonts.ready')
  assert page.locator('vite-error-overlay').count() == 0, 'Vite error overlay'
  assert len(cache) > 0, 'No API requests were captured'
  for width in [390,1440]:
   page.set_viewport_size({'width':width,'height':1000})
   page.screenshot(path=str(out/f'{name}-{width}.png'))
  print(name, 'captured',len(cache),'API responses',flush=True)
  ctx.close()
 b.close()
(out/'comparison-data.json').write_text(json.dumps({'condition':'same captured public API responses; dark theme; 7 default tickers; no holdings; 1000px height','endpoints':list(cache)},ensure_ascii=False,indent=2),encoding='utf-8')
