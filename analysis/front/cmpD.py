# モデルD: 今の評価順位(d2225/d26) と 前受けを足した評価順位(d2225f/d26f) を、前の年までで学習→次の年で比べる
import numpy as np
from scipy.optimize import minimize
LOM = -4.264394023053231
BASE = [0] + list(range(1, 12)) + [22, 23, 24] + [12, 13, 14]
def load(f):
    D = np.load(f); X0, W, G, ODDS, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "PAY", "META"])
    lo = X0[:, 0].astype(np.float64); lc = lo - LOM; is9 = (META[G, 2] >= 8).astype(float)
    X = np.column_stack([X0.astype(np.float64), lc**2, lc**3, lo*is9])[:, BASE]
    return dict(X=X, W=W == 1, G=G, ODDS=ODDS.astype(float), PAY=PAY.astype(float), YR=META[G, 0])
def grp(G):
    st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; return st, np.diff(np.r_[st, len(G)])
def fit(X, W, G):
    st, ln = grp(G)
    def f(b):
        u = X @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); s = np.add.reduceat(e, st)
        p = e / np.repeat(s, ln); return -(u[W] - mx - np.log(s)).sum(), -(X.T @ (W - p))
    b0 = np.zeros(X.shape[1]); b0[0] = 1
    return minimize(f, b0, jac=True, method="L-BFGS-B", options={"maxiter": 1000}).x
def prob(b, X, G):
    st, ln = grp(G); u = X @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln))
    return e / np.repeat(np.add.reduceat(e, st), ln)
def rule(P, T, m):
    O = T["ODDS"][m]; q = (P * O >= 1.05) & (O <= 20); PAY = T["PAY"][m]; W = T["W"][m]; G = T["G"][m]
    st, ln = grp(G); races = np.add.reduceat(q.astype(int), st) > 0; hits = np.add.reduceat((q & W).astype(int), st) > 0
    return int(q.sum()), int(races.sum()), 100 * hits.sum() / max(1, races.sum()), PAY[q].sum() / max(1, q.sum()), PAY[q].sum() - 100 * q.sum()
for tag, fa, fb in [("いま", "d2225.npz", "d26.npz"), ("前受けを足した評価順位", "d2225f.npz", "d26f.npz")]:
    A, B = load(fa), load(fb); tot = [0, 0.0]
    print("==", tag)
    for ty in [2023, 2024, 2025, 2026]:
        tr = A["YR"] < ty; T = B if ty == 2026 else A; m = np.ones(len(T["G"]), bool) if ty == 2026 else A["YR"] == ty
        b = fit(A["X"][tr], A["W"][tr], A["G"][tr]); P = prob(b, T["X"][m], T["G"][m])
        ll = np.log(P[T["W"][m]]).sum(); pts, rc, hit, roi, pl = rule(P, T, m); tot[0] += pts; tot[1] += pl
        print(f"  {ty}: 対数尤度 {ll:10.1f} | 期待値≥1.05・20倍以下 {pts}点 {rc}R 的中{hit:4.1f}% 回収{roi:5.1f}% 収支{pl:+,.0f} | er係数 {b[1]:+.4f}", flush=True)
    print(f"  4年計: {tot[0]}点 回収{100+tot[1]/max(1,tot[0]):.1f}% 収支{tot[1]:+,.0f}")
