"""예상 변동 범위 — 변동성 기반(비-AI, 비-방향성).

최근 일일 로그수익률의 표준편차(변동성)로, 향후 며칠간 가격이 머물
'통계적 범위'를 계산한다. 랜덤워크 가정하에 범위는 √시간에 비례해 넓어진다.

⚠️ 미래 가격을 맞히는 예측이 아니다. 방향(오를지 내릴지)은 말하지 않으며,
   중심은 현재가로 고정한다. 실제 가격은 이 범위를 벗어날 수 있다.
"""

import numpy as np
import pandas as pd


def expected_range(df: pd.DataFrame, horizon: int = 7,
                   z_inner: float = 1.0, z_outer: float = 2.0):
    """(현재가, 일일변동성σ, 밴드DataFrame) 반환.

    밴드는 미래 영업일 인덱스 + [upper/lower]_[inner/outer] 컬럼.
    inner ≈ z_inner·σ (기본 1σ, 약 68%), outer ≈ z_outer·σ (기본 2σ, 약 95%).
    """
    close = df["Close"].dropna()
    last = float(close.iloc[-1])
    logret = np.log(close / close.shift(1)).dropna()
    sigma = float(logret.std()) if len(logret) > 1 else 0.0

    future = pd.bdate_range(start=close.index[-1], periods=horizon + 1)[1:]
    t = np.arange(1, horizon + 1)
    scale = sigma * np.sqrt(t)

    band = pd.DataFrame(index=future)
    band["upper_inner"] = last * np.exp(z_inner * scale)
    band["lower_inner"] = last * np.exp(-z_inner * scale)
    band["upper_outer"] = last * np.exp(z_outer * scale)
    band["lower_outer"] = last * np.exp(-z_outer * scale)
    return last, sigma, band
