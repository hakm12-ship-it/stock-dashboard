"""레버리지 ETF 감쇠 분석.

일별로 재조정되는 L배 ETF는 기초자산이 R% 올라도 L×R%를 주지 않는다.
매일 L배로 복리가 붙기 때문에, 기초자산이 출렁일수록 수익이 깎인다
(변동성 감쇠). 변동성이 클수록·기간이 길수록 손실이 커진다.

기대와 실제의 차이를 두 갈래로 나눠 보여준다:
  - 복리효과: 일별 L배 복리 계산만으로 생기는 차이 (수수료 무관, 순수 수학)
  - 비용·추적오차: 그 이론값과 실제 ETF 수익의 차이 (보수·괴리)
"""

import numpy as np
import pandas as pd


def decay_analysis(etf_close: pd.Series, und_close: pd.Series, leverage: float) -> dict | None:
    """겹치는 구간만 비교. 표본이 너무 짧으면 None."""
    idx = etf_close.index.intersection(und_close.index)
    if len(idx) < 20:
        return None
    etf, und = etf_close[idx], und_close[idx]

    und_ret = float(und.iloc[-1] / und.iloc[0] - 1)
    etf_ret = float(etf.iloc[-1] / etf.iloc[0] - 1)

    # 투자자가 흔히 기대하는 값 — 기초자산 수익 × 배수
    naive = leverage * und_ret

    # 일별 L배 복리 (수수료·추적오차 제외한 순수 수학)
    daily = und.pct_change().dropna()
    theoretical = float(np.prod(1 + leverage * daily) - 1)

    vol = float(daily.std() * np.sqrt(252)) if len(daily) > 1 else 0.0

    return {
        "days": len(idx),
        "leverage": leverage,
        "underlyingReturn": und_ret * 100,
        "naiveExpected": naive * 100,
        "theoretical": theoretical * 100,
        "actualReturn": etf_ret * 100,
        # 기대 대비 총 손실과 그 원인 분해
        "totalDecay": (etf_ret - naive) * 100,
        "compoundingDrag": (theoretical - naive) * 100,
        "costDrag": (etf_ret - theoretical) * 100,
        "underlyingVol": vol * 100,
    }
