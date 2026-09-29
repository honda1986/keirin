# 2車複/2車単: 前の年までで学習 → 次の年で試す。各組の確率 p を年ごとに保存(pf_{kind}.npy)
import numpy as np, sys
from scipy.optimize import minimize
kind = sys.argv[1]
D = np.load(f"{kind}2.npz"); X0, LO, W, G, ODDS, META = (D[k] for k in ["X", "LO", "W", "G", "ODDS", "META"])
YR = META[G, 0]; is9 = (META[G, 2] >= 8).astype(float)
C = LO[YR <= 2022].mean()
lc = LO - C
X = np.column_stack([LO, lc**2, lc**3, LO * is9, X0.astype(np.float64)])
mu = X[:, 4:].mean(0); sd = X[:, 4:].std(0) + 1e-9; X[:, 4:] = (X[:, 4:] - mu) / sd    # 学習を安定させるため標準化
Wb = W == 1
def grp(Gs):
    st = np.r_[0, np.flatnonzero(np.diff(Gs)) + 1]; return st, np.diff(np.r_[st, len(Gs)])
def fit(m):
    Xs, Ws = X[m], Wb[m]; st, ln = grp(G[m])
    def f(b):
        u = Xs @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); s = np.add.reduceat(e, st)
        p = e / np.repeat(s, ln); return -(u[Ws] - mx - np.log(s)).sum() + 0.5 * (b[4:] ** 2).sum(), -(Xs.T @ (Ws - p)) + np.r_[np.zeros(4), b[4:]]
    b0 = np.zeros(X.shape[1]); b0[0] = 1
    return minimize(f, b0, jac=True, method="L-BFGS-B", options={"maxiter": 2000}).x
def prob(b, m):
    u = X[m] @ b; st, ln = grp(G[m]); mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln))
    return e / np.repeat(np.add.reduceat(e, st), ln)
P = np.full(len(G), np.nan)
Pm = np.full(len(G), np.nan)     # 市場だけ(K と曲がり)
for ty in [2023, 2024, 2025, 2026]:
    tr, te = YR < ty, YR == ty
    b = fit(tr); P[te] = prob(b, te)
    ll = np.log(P[te][Wb[te]]).sum()
    # 市場だけ
    Xk = X[:, :4].copy(); 
    st, ln = grp(G[tr])
    def fm(bb):
        u = Xk[tr] @ bb; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); s = np.add.reduceat(e, st)
        p = e / np.repeat(s, ln); return -(u[Wb[tr]] - mx - np.log(s)).sum(), -(Xk[tr].T @ (Wb[tr] - p))
    bm = minimize(fm, np.r_[1, 0, 0, 0.], jac=True, method="L-BFGS-B").x
    u = Xk[te] @ bm; st2, ln2 = grp(G[te]); mx = np.maximum.reduceat(u, st2); e = np.exp(u - np.repeat(mx, ln2)); Pm[te] = e / np.repeat(np.add.reduceat(e, st2), ln2)
    llm = np.log(Pm[te][Wb[te]]).sum()
    print(ty, f"対数尤度 モデル{ll:.0f} 市場だけ{llm:.0f} 差+{ll-llm:.0f}", "K=%.3f" % b[0], flush=True)
np.save(f"pf_{kind}.npy", P); np.save(f"pm_{kind}.npy", Pm)
