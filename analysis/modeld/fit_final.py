# 本番用: モデルDを 2022〜2026年9月の全部で学習
import numpy as np, json
from scipy.optimize import minimize
LOM = -4.264394023053231
def load(f, goff):
    D = np.load(f); X0, W, G, ODDS, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "PAY", "META"])
    lo = X0[:, 0].astype(np.float64); lc = lo - LOM; is9 = (META[G, 2] >= 8).astype(float)
    X = np.column_stack([X0.astype(np.float64), lc**2, lc**3, lo*is9])
    return X, W, G + goff, len(META)
Xa, Wa, Ga, na = load("d2225.npz", 0); Xb, Wb, Gb, nb = load("d26.npz", 10**7)
X = np.vstack([Xa, Xb]); W = np.r_[Wa, Wb]; G = np.r_[Ga, Gb]
cols = [0] + list(range(1, 12)) + [22, 23, 24] + [12, 13, 14]
Xs = X[:, cols]; Ws = W == 1
st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; ln = np.diff(np.r_[st, len(G)])
def f(b):
    u = Xs @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); s = np.add.reduceat(e, st)
    p = e / np.repeat(s, ln); return -(u[Ws] - mx - np.log(s)).sum(), -(Xs.T @ (Ws - p))
b0 = np.zeros(len(cols)); b0[0] = 1
r = minimize(f, b0, jac=True, method="L-BFGS-B", options={"maxiter": 1000})
names = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "lo2", "lo3", "lo9", "scz", "head", "srk"]
coef = {n: round(float(v), 6) for n, v in zip(names, r.x)}
print(r.success, len(st), "レース"); print(json.dumps(coef, ensure_ascii=False))
json.dump({"coef": coef, "LO_MEAN": LOM}, open("modelD_final.json", "w"))
