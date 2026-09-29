# 3連複を1レース複数点: モデルD(その年より前で学習)で、レースごとの的中率(どれか1点当たる)と回収率
import numpy as np
LOM = -4.264394023053231
cols = [0] + list(range(1, 12)) + [22, 23, 24] + [12, 13, 14]
def load(f):
    D = np.load(f); X0, W, G, ODDS, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "PAY", "META"])
    lo = X0[:, 0].astype(np.float64); lc = lo - LOM; is9 = (META[G, 2] >= 8).astype(float)
    return dict(X=np.column_stack([X0.astype(np.float64), lc**2, lc**3, lo*is9])[:, cols], W=W == 1, G=G, ODDS=ODDS.astype(float), PAY=PAY.astype(float), YR=META[G, 0])
A, B = load("d2225.npz"), load("d26.npz")
def grp(G):
    st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; return st, np.diff(np.r_[st, len(G)])
res = {}
for y in [2023, 2024, 2025, 2026]:
    T = B if y == 2026 else A; m = np.ones(len(T["G"]), bool) if y == 2026 else (A["YR"] == y)
    X, W, G, OD, PAY = T["X"][m], T["W"][m], T["G"][m], T["ODDS"][m], T["PAY"][m]
    b = np.load(f"cf_{y}_D.npy"); u = X @ b; st, ln = grp(G); mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln))
    P = e / np.repeat(np.add.reduceat(e, st), ln); EV = P * OD
    res[y] = (P, EV, OD, W, PAY, st, ln)
def run(lab, sel_fn):
    out = []
    for y in [2023, 2024, 2025, 2026]:
        P, EV, OD, W, PAY, st, ln = res[y]
        races = hits = pts = 0; ret = 0.0
        for a, l in zip(st, ln):
            s = sel_fn(P[a:a+l], EV[a:a+l], OD[a:a+l])
            if s is None or not s.any(): continue
            races += 1; pts += s.sum(); w = W[a:a+l][s]; hits += w.any(); ret += PAY[a:a+l][s].sum()
        out.append(f"{races:>5}R {pts/max(1,races):4.1f}点 的中{100*hits/max(1,races):4.1f}% 回収{ret/max(1,pts):5.1f}%")
    print(f"{lab:<34}" + " | ".join(out), flush=True)
run("いまのモデルD(1点)", lambda P, EV, OD: (lambda q: (np.arange(len(EV)) == np.argmax(np.where(q, EV, -1))) & q)((EV >= 1.1) & (OD >= 10) & (OD <= 30)))
for t in [1.0, 1.05, 1.1]:
    for H in [10, 20, 30]:
        run(f"期待値≥{t}・{H}倍以下を全部", lambda P, EV, OD, t=t, H=H: (EV >= t) & (OD <= H))
for k in [3, 5]:
    for t in [0.95, 1.0]:
        run(f"確率上位{k}点・{k}点の期待値平均≥{t}", lambda P, EV, OD, k=k, t=t: (lambda i: (np.isin(np.arange(len(P)), i)) if EV[i].mean() >= t else None)(np.argsort(-P)[:k]))
