# 2026年(学習に使っていない)で、決めておいたルールを試す: モデルD(2022〜2025で学習) 期待値≥1.1・30倍以下
import numpy as np, sys
from fit2 import VARIANTS
f = sys.argv[1] if len(sys.argv) > 1 else "d26.npz"
D = np.load(f); X0, W, G, ODDS, CD, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "CD", "PAY", "META"])
LOM = -4.264394023053231
lo = X0[:, 0].astype(np.float64); is9 = (META[G, 2] >= 8).astype(np.float64); lc = lo - LOM
X = np.column_stack([X0.astype(np.float64), lc ** 2, lc ** 3, lo * is9])
cols = VARIANTS["D C＋得点順位・得点z・先頭"]; b = np.load("cf_2026_D.npy")
st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; ln = np.diff(np.r_[st, len(G)])
def pr(u):
    mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); return e / np.repeat(np.add.reduceat(e, st), ln)
EV = pr(X[:, cols] @ b) * ODDS
EVc = pr(1.18 * lo + CD) * ODDS
M = META; hi = M[:, 4]; has = hi >= 0
mon = M[G, 1]
def s(m): k = int(m.sum()); return f"{k:>4}点 的中{100*(W[m]==1).mean() if k else 0:4.1f}% 回収{PAY[m].sum()/max(1,k):6.1f}%"
print(f"2026年 {len(M)}レース（月 {sorted(set(M[:,1]))}）")
rule = (EV >= 1.1) & (ODDS <= 30)
print("★決めておいたルール 期待値≥1.1・30倍以下: " + s(rule))
for mm in sorted(set(M[:, 1])): print(f"   {mm}月: " + s(rule & (mon == mm)))
print("  9車: " + s(rule & (M[G, 2] >= 8)) + " / 7車: " + s(rule & (M[G, 2] == 7)))
for a, c in [(0, 10), (10, 20), (20, 30)]: print(f"  {a}〜{c}倍: " + s((EV >= 1.1) & (ODDS >= a) & (ODDS < c)))
print("  参考 期待値≥1.05・30倍以下: " + s((EV >= 1.05) & (ODDS <= 30)) + " / 期待値≥1.2・30倍以下: " + s((EV >= 1.2) & (ODDS <= 30)))
hot = np.zeros(len(G), bool); ok = has & (M[:, 5] == 1) & (M[:, 6] == 1); hot[hi[ok]] = True
hot9 = np.zeros(len(G), bool); ok9 = ok & (M[:, 2] >= 8); hot9[hi[ok9]] = True
band9 = np.zeros(len(G), bool); okb = ok9 & (ODDS[np.maximum(hi, 0)] >= 5) & (ODDS[np.maximum(hi, 0)] <= 15); band9[hi[okb]] = True
print("\n比べる: いまの🔥(実際の買い方): " + s(hot) + " / 期待値(いまのev.js)≥1: " + s(hot & (EVc >= 1)))
print("        🔥9車: " + s(hot9) + " / 🔥7車(帯内): " + s(hot & ~hot9))
print("        🔥9車 5〜15倍: " + s(band9))
