# SS修正後の作り直し: モデルDを前の年までで学習→次の年で試す(2023〜2026)、本番係数(全部で学習)
#   python3 redo.py <npzのあるディレクトリ> [--save]   (--save で cf_{年}_D.npy と modelD_final.json を書く)
import numpy as np, json, sys, os
from scipy.optimize import minimize
LOM = -4.264394023053231
DIR = sys.argv[1]; SAVE = "--save" in sys.argv
cols = [0] + list(range(1, 12)) + [22, 23, 24] + [12, 13, 14]
names = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "lo2", "lo3", "lo9", "scz", "head", "srk"]
def load(f):
    D = np.load(f); X0, W, G, ODDS, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "PAY", "META"])
    lo = X0[:, 0].astype(np.float64); lc = lo - LOM; is9 = (META[G, 2] >= 8).astype(float)
    X = np.column_stack([X0.astype(np.float64), lc**2, lc**3, lo*is9])[:, cols]
    return dict(X=X, W=W == 1, G=G, ODDS=ODDS, PAY=PAY, YR=META[G, 0], NR=len(META))
A = load(os.path.join(DIR, "d2225.npz")); B = load(os.path.join(DIR, "d26.npz"))
def grp(G):
    st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; return st, np.diff(np.r_[st, len(G)])
def fit(X, W, G):
    st, ln = grp(G)
    def f(b):
        u = X @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); s = np.add.reduceat(e, st)
        p = e / np.repeat(s, ln); return -(u[W] - mx - np.log(s)).sum(), -(X.T @ (W - p))
    b0 = np.zeros(X.shape[1]); b0[0] = 1
    return minimize(f, b0, jac=True, method="L-BFGS-B", options={"maxiter": 1000}).x
def ev(b, X, G, ODDS):
    st, ln = grp(G); u = X @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln))
    return e / np.repeat(np.add.reduceat(e, st), ln) * ODDS
def score(E, G, ODDS, PAY, W):
    q = (E >= 1.1) & (ODDS >= 10) & (ODDS <= 30)
    st, ln = grp(G); Em = np.where(q, E, -np.inf); gm = np.maximum.reduceat(Em, st)
    idx = []
    for s, l, m in zip(st, ln, gm):
        if m == -np.inf: continue
        idx.append(s + int(np.argmax(Em[s:s + l])))
    idx = np.array(idx, int); n = len(idx); na = int(q.sum())
    return (f"1点 {n:>5}R 的中{100*W[idx].mean():4.1f}% 回収{PAY[idx].sum()/max(1,n):6.1f}% | "
            f"全部の組 {na:>6}点 回収{PAY[q].sum()/max(1,na):6.1f}%")
for ty in [2023, 2024, 2025, 2026]:
    tr = A["YR"] < ty
    b = fit(A["X"][tr], A["W"][tr], A["G"][tr])
    T = B if ty == 2026 else A
    te = np.ones(len(T["G"]), bool) if ty == 2026 else (A["YR"] == ty)
    E = ev(b, T["X"][te], T["G"][te], T["ODDS"][te])
    print(ty, score(E, T["G"][te], T["ODDS"][te], T["PAY"][te], T["W"][te]), flush=True)
    if SAVE: np.save(f"cf_{ty}_D.npy", b)
if SAVE:
    X = np.vstack([A["X"], B["X"]]); W = np.r_[A["W"], B["W"]]; G = np.r_[A["G"], B["G"] + 10**7]
    b = fit(X, W, G); coef = {n: round(float(v), 6) for n, v in zip(names, b)}
    print(A["NR"] + B["NR"], "レース", json.dumps(coef, ensure_ascii=False))
    json.dump({"coef": coef, "LO_MEAN": LOM}, open("modelD_final.json", "w"))
