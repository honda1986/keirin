# 見直し2: 🔥の条件(本命ライン先頭3人)を年ごとに。9車の単騎、7車の順位合計・帯、9車の帯
import numpy as np
from fit2 import W, G, ODDS, PAY, META
M = META; hi = M[:, 4]
def s(sel):
    rows = hi[sel]; n = len(rows)
    return f"{n:>5}R {100*(W[rows]==1).mean() if n else 0:4.1f}% {PAY[rows].sum()/max(1,n):6.1f}%"
Y = M[:, 0]; n = M[:, 2]; solo = M[:, 3]; rs = M[:, 7]; has = hi >= 0
od = np.where(has, ODDS[np.maximum(hi, 0)], 0)
print("本命ライン先頭3人の3連複(年: 2022 / 2023 / 2024 / 2025)")
def row(lab, cond):
    print(f"  {lab:<28} " + " | ".join(s(has & cond & (Y == y)) for y in [2022, 2023, 2024, 2025]))
row("9車 単騎0人", (n >= 8) & (solo == 0))
row("9車 単騎1人", (n >= 8) & (solo == 1))
row("9車 単騎2人以上", (n >= 8) & (solo >= 2))
row("9車 単騎≤1 5倍未満", (n >= 8) & (solo <= 1) & (od < 5))
row("9車 単騎≤1 5〜15倍", (n >= 8) & (solo <= 1) & (od >= 5) & (od <= 15))
row("9車 単騎≤1 15倍超", (n >= 8) & (solo <= 1) & (od > 15))
for lo_, hi_ in [(3, 9), (9, 12), (12, 14), (14, 30)]:
    row(f"7車 順位合計{lo_}〜{hi_-1}", (n == 7) & (rs >= lo_) & (rs < hi_))
row("7車 順位合計≥12 4〜15倍", (n == 7) & (rs >= 12) & (od >= 4) & (od <= 15))
row("7車 順位合計≥12 帯の外", (n == 7) & (rs >= 12) & ((od < 4) | (od > 15)))
row("7車 順位合計<12 4〜15倍", (n == 7) & (rs < 12) & (od >= 4) & (od <= 15))
row("6車以下", (n <= 6))
