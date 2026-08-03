"""HBM/AI 밸류체인 관련 미국 종목 — 삼성전자·SK하이닉스의 '실시간 시사점' 패널에 사용."""

# (티커, 한글명, 역할설명)
_HBM_CHAIN = [
    ("NVDA", "엔비디아", "HBM 최대 고객"),
    ("MU", "마이크론", "메모리 직접 경쟁사"),
    ("AMD", "AMD", "AI GPU — HBM 수요"),
    ("AVGO", "브로드컴", "AI 네트워킹·커스텀"),
    ("MRVL", "마벨", "AI 커스텀 실리콘"),
    ("MSFT", "마이크로소프트", "하이퍼스케일러 AI capex"),
    ("GOOGL", "알파벳", "AI capex"),
    ("AMZN", "아마존", "클라우드 capex"),
    ("META", "메타", "AI capex"),
    ("WDC", "웨스턴디지털", "NAND 경쟁사"),
]

RELATED_STOCKS = {
    "000660": _HBM_CHAIN,
    "005930": _HBM_CHAIN,
}
