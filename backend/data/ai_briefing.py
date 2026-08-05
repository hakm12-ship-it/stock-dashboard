"""Gemini 기반 종목 AI 브리핑 — 규칙기반 신호·가치 데이터를 요약해 짧은 코멘트를 생성."""

import json
import os
import urllib.request

_MODEL = "gemini-flash-latest"
_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent"


def _ask(prompt: str, as_json: bool = False) -> str:
    """Gemini에 한 번 물어보고 본문 텍스트를 돌려준다.

    키가 없거나 호출이 실패하면 예외를 그대로 올린다 — 호출부(routers/ai.py)가
    직전 성공 결과로 대체할지 판단한다.
    """
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")

    payload: dict = {"contents": [{"parts": [{"text": prompt}]}]}
    if as_json:
        payload["generationConfig"] = {"responseMimeType": "application/json"}

    req = urllib.request.Request(
        f"{_URL}?key={key}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]


def generate_briefing(name: str, ticker: str, context: dict) -> dict:
    """context: {verdict, changePct, per, pbr, rsi, support, resistance, ...}.

    반환: {stance, summary, bullets: [str]}. 키가 없거나 실패하면 예외를 던진다.
    """
    prompt = f"""당신은 한국 주식 투자자를 위한 간단한 시황 브리핑을 작성하는 애널리스트입니다.
아래 데이터를 참고해 "{name}({ticker})"에 대한 짧은 브리핑을 JSON으로만 작성하세요.

데이터: {json.dumps(context, ensure_ascii=False)}

출력 형식(JSON만, 다른 텍스트 없이):
{{"stance": "강세" 또는 "약세" 또는 "중립", "summary": "한 문장 요약", "bullets": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"]}}

투자 조언이 아닌 참고용 해설임을 전제로, 과장 없이 데이터에 근거해 작성하세요."""

    parsed = json.loads(_ask(prompt, as_json=True))
    return {
        "stance": parsed.get("stance", "중립"),
        "summary": parsed.get("summary", ""),
        "bullets": parsed.get("bullets", []),
    }


def generate_portfolio_review(context: dict, observations: list[str]) -> dict:
    """보유 포트폴리오 진단 코멘트.

    수치와 관찰은 이미 규칙기반으로 나와 있고(analysis/portfolio.py), LLM은
    그걸 애널리스트 문체로 옮기는 일만 한다. 새로운 사실을 만들어내지 않게
    "주어진 데이터 밖의 내용을 쓰지 말 것"을 명시한다.

    매수·매도 권유는 금지한다 — 이 앱은 참고용 도구지 투자자문이 아니다.
    """
    prompt = f"""당신은 개인 투자자의 포트폴리오 구성을 설명해 주는 애널리스트입니다.
아래는 한 투자자의 보유 현황을 계산한 결과입니다.

수치: {json.dumps(context, ensure_ascii=False)}

이미 도출된 관찰:
{chr(10).join("- " + o for o in observations)}

이 데이터를 근거로 포트폴리오의 **구성상 특징**을 설명하는 코멘트를 JSON으로만 작성하세요.

규칙:
- 특정 종목을 사라/팔라/줄여라/늘려라 같은 권유는 절대 쓰지 마세요. 구성이 어떤 성격인지 서술만 하세요.
- 주어진 수치 밖의 사실(뉴스, 전망, 목표가 등)을 지어내지 마세요.
- 좋다/나쁘다로 평가하지 말고, 어떤 성격의 포트폴리오인지, 무엇에 민감한 구조인지를 설명하세요.
- 한국어, 과장 없이, 담백하게.

출력 형식(JSON만, 다른 텍스트 없이):
{{"headline": "이 포트폴리오의 성격을 한 문장으로", "summary": "2~3문장 설명", "watchPoints": ["이 구성에서 값이 크게 움직일 수 있는 지점 1", "지점 2", "지점 3"]}}"""

    parsed = json.loads(_ask(prompt, as_json=True))
    return {
        "headline": parsed.get("headline", ""),
        "summary": parsed.get("summary", ""),
        "watchPoints": parsed.get("watchPoints", []),
    }


def generate_market_insight(name: str, stocks: list[dict]) -> str:
    """stocks: [{name, role, changePct}] — 관련종목 등락으로 한 줄 시사점 생성."""
    prompt = f"""당신은 반도체 밸류체인을 분석하는 애널리스트입니다.
"{name}"의 관련종목(미국 증시) 등락률 데이터를 보고, 이 데이터가 {name}에 시사하는 바를 한국어 한두 문장으로 요약하세요.

데이터: {json.dumps(stocks, ensure_ascii=False)}

과장 없이 데이터에 근거해, 방향성이 뚜렷한지 엇갈리는지도 언급하세요.
출력은 순수 텍스트 한두 문장만 (따옴표·JSON 없이)."""

    return _ask(prompt).strip()
