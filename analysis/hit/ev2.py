import numpy as np, sys
kind = sys.argv[1]
D = np.load(f"{kind}2.npz"); W, G, ODDS, META = D["W"] == 1, D["G"], D["ODDS"].astype(float), D["META"]
P = np.load(f"pf_{kind}.npy"); YR = META[G, 0]; N9 = META[G, 2] >= 8
st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; ln = np.diff(np.r_[st, len(G)])
EV = P * ODDS
def pick(score, ok):
    s = np.where(ok, score, -np.inf); m = np.maximum.reduceat(s, st); idx = []
    for a, l, v in zip(st, ln, m):
        if v > -np.inf: idx.append(a + int(np.argmax(s[a:a + l])))
    return np.array(idx, int)
def show(lab, idx):
    out = []
    for y in [2023, 2024, 2025, 2026]:
        i = idx[YR[idx] == y]; n = len(i)
        out.append(f"{n:>5}R 的中{100*W[i].mean() if n else 0:4.1f}% 回収{100*(W[i]*ODDS[i]).sum()/max(1,n):5.1f}%")
    print(f"{lab:<26}" + " | ".join(out), flush=True)
tst = YR >= 2023
show("市場1番人気", pick(-ODDS, tst))
show("モデル最有力", pick(P, tst))
for cap in [3, 5, 8]:
    for t in [1.0, 1.05, 1.1]:
        show(f"期待値≥{t} {cap}倍以下 最高期待値", pick(EV, tst & (EV >= t) & (ODDS <= cap)))
for lo_, hi_ in [(1, 2), (2, 3), (3, 5)]:
    show(f"最有力が{lo_}〜{hi_}倍・期待値≥1", pick(P, tst & (ODDS >= lo_) & (ODDS < hi_) & (EV >= 1.0)))
