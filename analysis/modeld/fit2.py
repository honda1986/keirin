# モデルの形を比べる: オッズの曲がり(対数オッズの2乗・3乗)、9車の傾き、評価順位 vs 得点順位、ラインの特徴
import numpy as np
from scipy.optimize import minimize
D = np.load("d2225.npz")
X0, W, G, ODDS, CD, PAY, META = (D[k] for k in ["X", "W", "G", "ODDS", "CD", "PAY", "META"])
lo = X0[:, 0].astype(np.float64)
is9 = (META[G, 2] >= 8).astype(np.float64)
lc = lo - lo.mean()
X = np.column_stack([X0.astype(np.float64), lc ** 2, lc ** 3, lo * is9])
NAMES = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "scz", "head", "srk",
         "line3", "linetop3", "mainTop3", "pair", "mainTop3_9", "mainTop3_solo2", "linetop3_9", "lo2", "lo3", "lo_9"]
rowYR = META[G, 0]
RID_CUR = list(range(1, 12))
ODD = [22, 23, 24]
TRIO = list(range(15, 22))
VARIANTS = {
    "A 市場だけ(K)": [0],
    "B いまの特徴": [0] + RID_CUR,
    "C B＋オッズの曲がり": [0] + RID_CUR + ODD,
    "D C＋得点順位・得点z・先頭": [0] + RID_CUR + ODD + [12, 13, 14],
    "E D＋ラインの特徴": [0] + RID_CUR + ODD + [12, 13, 14] + TRIO,
    "F Eから評価順位を抜く": [0] + [c for c in RID_CUR if c != 1] + ODD + [12, 13, 14] + TRIO,
}
def _grp(Gs):
    st = np.r_[0, np.flatnonzero(np.diff(Gs)) + 1]; return st, np.diff(np.r_[st, len(Gs)])
def fit(cols, m):
    Xs = X[m][:, cols]; Ws = W[m] == 1; st, ln = _grp(G[m])
    def f(b):
        u = Xs @ b; mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln)); s = np.add.reduceat(e, st)
        p = e / np.repeat(s, ln); return -(u[Ws] - mx - np.log(s)).sum(), -(Xs.T @ (Ws - p))
    b0 = np.zeros(len(cols)); b0[0] = 1.0
    return minimize(f, b0, jac=True, method="L-BFGS-B", options={"maxiter": 500}).x
def probs(b, cols, m):
    u = X[m][:, cols] @ b; st, ln = _grp(G[m]); mx = np.maximum.reduceat(u, st); e = np.exp(u - np.repeat(mx, ln))
    return e / np.repeat(np.add.reduceat(e, st), ln)
if __name__ == "__main__":
    out = {}
    for ty in [2023, 2024, 2025]:
        tr, te = rowYR < ty, rowYR == ty
        base = None
        print(f"\n===== 学習〜{ty-1} → {ty} =====")
        for nm, cols in VARIANTS.items():
            b = fit(cols, tr); p = probs(b, cols, te); ll = np.log(p[W[te] == 1]).sum()
            base = ll if base is None else base
            ev = p * ODDS[te]; pay = PAY[te]; od = ODDS[te]
            s1 = (ev >= 1.1) & (od <= 30); s2 = (ev >= 1.1)
            np.save(f"cf_{ty}_{nm[0]}.npy", b)
            print(f"  {nm}: 対数尤度 +{ll-base:.1f} | 期待値≥1.1・30倍以下 {s1.sum()}点 回収{pay[s1].sum()/max(1,s1.sum()):.1f}% | 期待値≥1.1(倍率制限なし) {s2.sum()}点 回収{pay[s2].sum()/max(1,s2.sum()):.1f}%")
            if nm[0] in "E":
                print("     " + " ".join(f"{NAMES[c]}={v:+.3f}" for c, v in zip(cols, b)))
