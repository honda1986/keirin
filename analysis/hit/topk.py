import numpy as np
exec(open("../hit/multi3.py").read().split("def run(")[0])
# レースごとに 確率上位k点の [確率の合計, 期待値の平均, 当たり, 払戻合計] を前計算
pre = {}
for y in [2023, 2024, 2025, 2026]:
    P, EV, OD, W, PAY, st, ln = res[y]; rows = []
    for a, l in zip(st, ln):
        o = np.argsort(-P[a:a+l]); r = []
        for k in [2, 3, 4, 5, 6]:
            i = o[:k] + a; r.append((P[i].sum(), EV[i].mean(), W[i].any(), PAY[i].sum(), OD[i].min()))
        rows.append(r)
    pre[y] = rows
ks = [2, 3, 4, 5, 6]
lines = []
for ki, k in enumerate(ks):
    for t in [0.9, 0.95, 1.0]:
        for cov in [0.0, 0.3, 0.4, 0.5]:
            out = []; tot = [0, 0, 0.0]
            for y in [2023, 2024, 2025, 2026]:
                n = h = 0; ret = 0.0
                for r in pre[y]:
                    c, e, w, p, mo = r[ki]
                    if e >= t and c >= cov: n += 1; h += w; ret += p
                out.append((n, 100*h/max(1,n), ret/max(1,n*k)))
                if y < 2026: tot[0] += n; tot[1] += h; tot[2] += ret
            lines.append((k, t, cov, out, tot))
print("k点 期待値平均 確率の合計 | 2023 / 2024 / 2025 (レース数・的中・回収) | 2026(確かめ)")
for k, t, cov, out, tot in lines:
    if tot[0] < 150: continue
    worst = min(o[2] for o in out[:3])
    if worst < 80: continue
    print(f"{k}点 ≥{t} ≥{cov:.1f} | " + " / ".join(f"{n}R {h:.0f}% {r:.0f}%" for n, h, r in out[:3]) + f" | 2026: {out[3][0]}R 的中{out[3][1]:.0f}% 回収{out[3][2]:.0f}%")
