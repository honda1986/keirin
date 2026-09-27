# 係数の違いで「期待値1.1以上・10〜30倍(1レース1点)」の成績がどれだけ変わるか
import numpy as np, json
LOM = -4.264394023053231
cols = [0] + list(range(1, 12)) + [22, 23, 24] + [12, 13, 14]
names = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "lo2", "lo3", "lo9", "scz", "head", "srk"]
def load(f):
    D = np.load(f); X0, W, G, ODDS, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "PAY", "META"])
    lo = X0[:, 0].astype(np.float64); lc = lo - LOM; is9 = (META[G, 2] >= 8).astype(float)
    X = np.column_stack([X0.astype(np.float64), lc**2, lc**3, lo*is9])[:, cols]
    return X, W, G, ODDS, PAY, META[G, 0]
def evs(X, G, ODDS, b):
    st = np.r_[0, np.flatnonzero(np.diff(G)) + 1]; ln = np.diff(np.r_[st, len(G)])
    u = X @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); p = e / np.repeat(np.add.reduceat(e, st), ln)
    return p * ODDS, st, ln
def best1(EV, ODDS, st, ln, lo=10, hi=30, t=1.1):
    sel = np.zeros(len(EV), bool)
    ok = (EV >= t) & (ODDS >= lo) & (ODDS <= hi)
    for s, l in zip(st, ln):
        m = ok[s:s+l]
        if m.any():
            j = s + np.argmax(np.where(m, EV[s:s+l], -1)); sel[j] = True
    return sel
def s(m, PAY, W): k = m.sum(); return f"{k:>4}点 的中{100*(W[m]==1).mean() if k else 0:4.1f}% {PAY[m].sum()/max(1,k):6.1f}%"
fin = json.load(open("modelD_final.json"))["coef"]; bfin = np.array([fin[n] for n in names])
coefs = {"〜2025で学習": np.load("cf_2026_D.npy"), "全部(〜2026/9)で学習=本番": bfin}
X, W, G, O, P, Y = load("d26.npz")
print("2026年: 1レース1点・期待値1.1以上・10〜30倍")
for nm, b in coefs.items():
    EV, st, ln = evs(X, G, O, b); sel = best1(EV, O, st, ln)
    allm = (EV >= 1.1) & (O >= 10) & (O <= 30)
    print(f"  {nm}: 1点 {s(sel, P, W)} / 全部の組 {s(allm, P, W)}")
EV1, st, ln = evs(X, G, O, coefs["〜2025で学習"]); EV2, _, _ = evs(X, G, O, bfin)
a = best1(EV1, O, st, ln); b2 = best1(EV2, O, st, ln)
print(f"  両方で選ばれた {s(a & b2, P, W)} / 〜2025だけ {s(a & ~b2, P, W)} / 本番だけ {s(~a & b2, P, W)}")
print("  係数の差: " + " ".join(f"{n} {coefs['〜2025で学習'][i]:+.3f}→{bfin[i]:+.3f}" for i, n in enumerate(names)))

print("\n2023〜2025(前の年までで学習): 1レース1点 vs 全部の組 / 1レースに何点")
X, W, G, O, P, Y = load("d2225.npz")
for y in [2023, 2024, 2025]:
    m = Y == y
    b = np.load(f"cf_{y}_D.npy")
    EV = np.zeros(len(G))
    Xs, Gs = X[m], G[m]
    ev, st, ln = evs(Xs, Gs, O[m], b)
    sel = best1(ev, O[m], st, ln); allm = (ev >= 1.1) & (O[m] >= 10) & (O[m] <= 30)
    Pm, Wm = P[m], W[m]
    g = Gs[allm]; u, c = np.unique(g, return_counts=True)
    multi = np.isin(Gs, u[c >= 2]) & allm
    print(f"  {y}: 1点 {s(sel, Pm, Wm)} / 全部 {s(allm, Pm, Wm)} / 2点以上のレースの組 {s(multi, Pm, Wm)} / 2番目以降だけ {s(allm & ~sel, Pm, Wm)}")
