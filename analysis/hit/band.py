# モデルDの買う倍率の帯を変えたら(hikitsugi §4-43)。dall.py と同じ計算(その年より前で作ったモデル・確定オッズ)で 期待値1.10以上の組を帯ごとに数える
import json, numpy as np, feat, collections
LOM = -4.264394023053231
names = ["K", "er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "lo2", "lo3", "lo9", "scz", "head", "srk"]
RI = {k: j for j, k in enumerate(feat.RIDER_F)}
out = []  # [id, 年, 車立て, 組, 期待値, 倍率, 払戻]
def run(src, coef, lo_id, hi_id):
    b = dict(zip(names, np.load(coef)))
    for l in open(src, encoding="utf-8"):
        r = json.loads(l)
        if not (lo_id <= r["id"] < hi_id): continue
        keep, lo, RX, TX, wi, cd, info = feat.race_rows(r)
        if len(keep) < len(feat.TRIOS[r["n"]]) * 0.8: continue
        lo = np.array(lo); lc = lo - LOM; is9 = 1.0 if r["n"] >= 8 else 0.0
        u = b["K"] * lo + b["lo2"] * lc**2 + b["lo3"] * lc**3 + b["lo9"] * lo * is9
        for k in RI: u = u + b[k] * RX[:, RI[k]]
        p = np.exp(u - u.max()); p /= p.sum(); odds = np.exp(-lo); ev = p * odds
        sel = np.flatnonzero((ev >= 1.05) & (odds <= 40))
        w = "=".join(map(str, sorted(r["fin"])))
        for j in sel:
            t = "=".join(map(str, keep[j])); pay = 0
            if t == w: pay = r["p3f"][1] if (r.get("p3f") and r["p3f"][0] == w) else odds[j] * 100
            out.append([r["id"], r["y"], r["n"], t, round(float(ev[j]), 4), round(float(odds[j]), 2), float(pay)])
for y in [2023, 2024, 2025]: run("races.jsonl", f"cf_{y}_D.npy", str(y), str(y + 1))
run("races26.jsonl", "cf_2026_D.npy", "2026", "2027")
R = out
def st(f, ev=1.10):
    by = collections.defaultdict(lambda: [0, 0, 0.0])
    for id_, y, n, t, e, o, pay in R:
        if e >= ev and f(o):
            a = by[y]; a[0] += 1; a[1] += pay > 0; a[2] += pay
    if not by: return "0点"
    tot = [sum(by[y][i] for y in by) for i in range(3)]
    ys = " ".join(f"{y}:{by[y][2]/by[y][0]:.1f}%" for y in sorted(by))
    return f"{tot[0]:5d}点 的中{tot[1]:4d} 回収{tot[2]/tot[0]:6.1f}% 収支{tot[2]-100*tot[0]:+8.0f}円 | {ys}"
print("いま 0〜20倍 :", st(lambda o: o <= 20))
print("案  2〜18倍  :", st(lambda o: 2 <= o <= 18))
print()
print("--- 帯ごと(期待値1.10以上) ---")
for lo, hi in [(0, 2), (2, 3), (3, 5), (5, 8), (8, 10), (10, 12), (12, 15), (15, 18), (18, 20), (20, 25), (25, 30), (30, 40)]:
    print(f"{lo:>2}〜{hi:<2}倍:", st(lambda o, lo=lo, hi=hi: lo <= o < hi if hi != 20 else lo <= o <= 20))
print()
print("--- 上限・下限を動かす ---")
for lo in [0, 2, 3]:
    for hi in [15, 16, 18, 20, 22, 25]:
        print(f"{lo}〜{hi}倍:", st(lambda o, lo=lo, hi=hi: lo <= o <= hi))
