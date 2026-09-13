"""Read-only local API checks. Never invokes notification or OAuth mutation endpoints."""
import concurrent.futures
import json
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

CASES=[('health',{}),('symbols',{'market':'KR','q':'삼성'}),('symbols',{'market':'US','q':'Apple'}),('prices',{'ticker':'005930','period':'3m'}),('indicators',{'ticker':'005930','period':'3m'}),('signal',{'ticker':'005930'}),('forecast',{'ticker':'005930'}),('valuation',{'market':'KR','ticker':'005930'}),('news',{'market':'KR','name':'삼성전자'}),('index',{'name':'KOSPI'}),('fx',{}),('macro',{}),('daily-report',{}),('market-top',{'direction':'up','market':'KOSPI'}),('groups',{'kind':'industry'}),('night-price',{'ticker':'005930'}),('synth-price',{'ticker':'KORU'})]
def run(case):
 name,params=case
 url='http://localhost:8000/api/'+name+'?'+urlencode(params)
 try:
  with urlopen(url,timeout=60) as r:
   data=json.load(r)
   result={'endpoint':name,'params':params,'status':r.status,'noindex':r.headers.get('X-Robots-Tag'),'shape':list(data.keys()) if isinstance(data,dict) else 'list','count':len(data) if isinstance(data,list) else None}
   result['passed']=r.status==200 and isinstance(data,(list,dict)) and result['noindex']=='noindex, nofollow'
   return result
 except Exception as e: return {'endpoint':name,'passed':False,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(run,CASES))
# Check authorization before any notification code executes. No token supplied.
for endpoint in ['market-alert-check','night-alert-check','kakao-redirect-uri','kakao-token-status']:
 try:
  with urlopen('http://localhost:8000/api/'+endpoint,timeout=10) as response: code=response.status
 except HTTPError as error: code=error.code
 results.append({'endpoint':endpoint,'status':code,'passed':code in (401,503),'check':'unauthenticated request rejected'})
for path in ['/', '/robots.txt', '/sitemap.xml']:
 with urlopen('http://localhost:8000'+path,timeout=10) as response:
  results.append({'endpoint':path,'status':response.status,'passed':response.status==200,'check':'production static serving'})
out=Path('artifacts/renewal');out.mkdir(parents=True,exist_ok=True)
(out/'api-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
for r in results: print('PASS' if r['passed'] else 'FAIL',r['endpoint'],r.get('status',r.get('error')),flush=True)
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
