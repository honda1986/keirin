# モデルD に S・B を足すと良くなるか: 前の年までで学習 → 次の年で試す
import numpy as np, sys
from scipy.optimize import minimize
LOM = -4.264394023053231
BASE = [0] + list(range(1, 12)) + [22, 23, 24] + [12, 13, 14]
def load(f, sbf):
    D = np.load(f); X0, W, G, ODDS, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "PAY", "META"])
    lo = X0[:, 0].astype(np.float64); lc = lo - LOM; is9 = (META[G, 2] >= 8).astype(float)
    X = np.column_stack([X0.astype(np.float64), lc**2, lc**3, lo*is9, np.load(sbf).astype(np.float64)])
    return dict(X=X, W=W == 1, G=G, ODDS=ODDS.astype(float), PAY=PAY.astype(float), YR=META[G, 0])
A, B = load("d2225.npz", "sb2225.npy"), load("d26.npz", "sb26.npy")
SBC = {n: 25 + i for i, n in enumerate(["bz", "sz", "head_bz", "fol_lb", "head_sz"])}
VAR = {"D(いま)": BASE, "D＋S・B全部": BASE + list(SBC.values()), "D＋B系(bz・先頭bz・後ろの先頭bz)": BASE + [SBC["bz"], SBC["head_bz"], SBC["fol_lb"]],
       "D＋S系(sz・先頭sz)": BASE + [SBC["sz"], SBC["head_sz"]]}
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
    EV = P * T["ODDS"][m]; q = (EV >= 1.05) & (T["ODDS"][m] <= 20); G = T["G"][m]; W = T["W"][m]; PAY = T["PAY"][m]
    st, ln = grp(G); races = np.add.reduceat(q.astype(int), st) > 0; hits = np.add.reduceat((q & W).astype(int), st) > 0
    return f"{int(q.sum()):>5}点 {int(races.sum()):>5}R 的中{100*hits.sum()/max(1,races.sum()):4.1f}% 回収{PAY[q].sum()/max(1,q.sum()):6.1f}%"
res = {}
for ty in [2023, 2024, 2025, 2026]:
    tr = A["YR"] < ty; T = B if ty == 2026 else A; m = np.ones(len(T["G"]), bool) if ty == 2026 else (A["YR"] == ty)
    base_ll = None
    print(f"== 学習〜{ty-1} → {ty}", flush=True)
    for nm, cols in VAR.items():
        b = fit(A["X"][tr][:, cols], A["W"][tr], A["G"][tr]); P = prob(b, T["X"][m][:, cols], T["G"][m])
        ll = np.log(P[T["W"][m]]).sum(); base_ll = ll if base_ll is None else base_ll
        extra = " ".join(f"{k}={b[cols.index(c)]:+.3f}" for k, c in SBC.items() if c in cols)
        print(f"  {nm:<32} 対数尤度 {ll-base_ll:+7.1f} | 期待値≥1.05・20倍以下 {rule(P, T, m)} | {extra}", flush=True)
