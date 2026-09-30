# 初手の前受け(S を取った選手のライン)を予想する。Kドリームスの並び予想の先頭ライン vs モデル
#   python3 front.py <res-*.json のディレクトリ>
import json, sys, os, glob, collections, numpy as np
from scipy.optimize import minimize
RES = {}
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "res", "res-*.json"))):
    RES.update(json.load(open(f))["races"])
FEAT = ["pred_front", "pred_last", "pos_rel", "size2", "size3", "size4", "solo", "head_nige", "head_ryo", "s_max", "s_head", "s_2nd",
        "b_head", "nige_head", "score_z", "best_rank1", "has_rank1"]
rows = []   # (年, [線ごとの特徴], S の線の添字, 予想先頭の添字)
skip = collections.Counter()
for l in open("cards.jsonl", encoding="utf-8"):
    r = json.loads(l); res = RES.get(r["id"])
    if not res: skip["結果なし"] += 1; continue
    S = res.get("S"); L = r["lines"]
    if not S or len(L) < 2: skip["Sなし・1ライン"] += 1; continue
    if all(len(x) == 1 for x in L): skip["全員単騎"] += 1; continue
    si = next((i for i, x in enumerate(L) if S in x), None)
    if si is None: skip["S が並びにいない"] += 1; continue
    E = {int(k): v for k, v in r["E"].items()}
    sc = np.array([E[c][4] for c in E], float); m, sd = sc.mean(), sc.std() or 1
    rank1 = min(E, key=lambda c: E[c][5])
    X = []
    for i, x in enumerate(L):
        rate = lambda c, k: (E[c][k] / E[c][3]) if E[c][3] > 0 else 0.0
        h = x[0]; ky = E[h][0]
        X.append([1.0 if i == 0 else 0.0, 1.0 if i == len(L) - 1 else 0.0, i / (len(L) - 1),
                  1.0 if len(x) == 2 else 0.0, 1.0 if len(x) == 3 else 0.0, 1.0 if len(x) >= 4 else 0.0, 1.0 if len(x) == 1 else 0.0,
                  1.0 if ky == "逃" else 0.0, 1.0 if ky == "両" else 0.0,
                  max(rate(c, 1) for c in x), rate(h, 1), rate(x[1], 1) if len(x) > 1 else 0.0,
                  rate(h, 2), rate(h, 6) if False else (E[h][6] / max(1, E[h][3])),
                  (np.mean([E[c][4] for c in x]) - m) / sd, min(E[c][5] for c in x) / 9.0, 1.0 if rank1 in x else 0.0])
    rows.append((r["id"], np.array(X), si, 0, L, rank1))

def fit(R):
    def f(b):
        ll = 0.0; g = np.zeros_like(b)
        for r in R:
            X, si = r[1], r[2]
            u = X @ b; u -= u.max(); p = np.exp(u); p /= p.sum()
            ll += np.log(p[si]); g += X[si] - p @ X
        return -ll + 0.01 * (b @ b), -g + 0.02 * b
    return minimize(f, np.zeros(len(FEAT)), jac=True, method="L-BFGS-B").x
def probs(b, X):
    u = X @ b; p = np.exp(u - u.max()); return p / p.sum()
