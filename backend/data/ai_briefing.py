"""Gemini 기반 종목 AI 브리핑 — 규칙기반 신호·가치 데이터를 요약해 짧은 코멘트를 생성."""

import json
import os
import urllib.request

_MODEL = "gemini-flash-latest"
_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent"


def _api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY")


def generate_briefing(name: str, ticker: str, context: dict) -> dict:
    """context: {verdict, changePct, per, pbr, rsi, support, resistance, ...}.

    반환: {stance, summary, bullets: [str]}. 키가 없거나 실패하면 예외를 던진다.
    """
    key = _api_key()
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")

    prompt = f"""당신은 한국 주식 투자자를 위한 간단한 시황 브리핑을 작성하는 애널리스트입니다.
아래 데이터를 참고해 "{name}({ticker})"에 대한 짧은 브리핑을 JSON으로만 작성하세요.

데이터: {json.dumps(context, ensure_ascii=False)}

출력 형식(JSON만, 다른 텍스트 없이):
{{"stance": "강세" 또는 "약세" 또는 "중립", "summary": "한 문장 요약", "bullets": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"]}}

투자 조언이 아닌 참고용 해설임을 전제로, 과장 없이 데이터에 근거해 작성하세요."""

    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()

    req = urllib.request.Request(
        f"{_URL}?key={key}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read())

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    return {
        "stance": parsed.get("stance", "중립"),
        "summary": parsed.get("summary", ""),
        "bullets": parsed.get("bullets", []),
    }
