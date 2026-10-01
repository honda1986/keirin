# 本番用: モデルD＋競り(先頭・カッコの前・カッコの後・2人とも入る組)を 2022〜2026年9月の全部で学習
import numpy as np, json
from scipy.optimize import minimize
LOM = -4.264394023053231
def load(f, sf, goff):
    D = np.load(f); X0, W, G, META = (D[k] for k in ["X", "W", "G", "META"])
    lo = X0[:, 0].astype(np.float64); lc = lo - LOM; is9 = (META[G, 2] >= 8).astype(float)
    X = np.column_stack([X0.astype(np.float64), lc**2, lc**3, lo*is9, np.load(sf).astype(np.float64)[:, :4]])
    return X, W, G + goff
Xa, Wa, Ga = load("d2225.npz", "seri2225.npy", 0); Xb, Wb, Gb = load("d26.npz", "seri26.npy", 10**7)
X = np.vstack([Xa, Xb]); W = np.r_[Wa, Wb] == 1; G = np.r_[Ga, Gb]
names = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "lo2", "lo3", "lo9", "scz", "head", "srk"]
base = [0] + list(range(1, 12)) + [22, 23, 24] + [12, 13, 14]
st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; ln = np.diff(np.r_[st, len(G)])
def fit(cols):
    Xs = X[:, cols]
    def f(b):
        u = Xs @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); s = np.add.reduceat(e, st)
        p = e / np.repeat(s, ln); return -(u[W] - mx - np.log(s)).sum(), -(Xs.T @ (W - p))
    b0 = np.zeros(len(cols)); b0[0] = 1
    r = minimize(f, b0, jac=True, method="L-BFGS-B", options={"maxiter": 2000}); return r
r0 = fit(base); r1 = fit(base + [25, 26, 27, 28])
print("レース", len(st), "成功", r0.success, r1.success, "対数尤度", -r0.fun, "→", -r1.fun, f"(+{r0.fun - r1.fun:.1f})")
c0 = {n: round(float(v), 6) for n, v in zip(names, r0.x)}
c1 = {n: round(float(v), 6) for n, v in zip(names + ["s_head", "s_front", "s_back", "s_both"], r1.x)}
print("競り無し(いまの evd.js と同じはず):", json.dumps(c0)); print("競りあり:", json.dumps(c1))
json.dump({"coef": c1, "LO_MEAN": LOM}, open("modelD_final_seri.json", "w"))
