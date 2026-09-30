# 評価点(riders[5])に「そのラインの前受け確率 × a」を足して並べ直す。◎の1着・上位3人の3連複・🔥(9車5〜15倍SS無し)の回収
import json, itertools, collections, sys
sys.path.insert(0, "../rv"); import feat
PF = json.load(open("pf.json")); SS = set(json.load(open("../rv/ss_ids.json"))); RB = json.load(open("../pc/rbss.json"))
D = []
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = PF.get(r["id"]); b = RB.get(r["id"])
    if not v or not b or not b.get("riders") or not r.get("fin") or len(r["fin"]) < 3: continue
    tot = {x[0]: x[5] for x in b["riders"]}
    if any(t is None for t in tot.values()): continue
    pl, pos = {}, {}
    for ln, p in zip(v["lines"], v["p"]):
        for i, c in enumerate(ln): pl[c] = p; pos[c] = (i if len(ln) >= 2 else -1)
    if set(pl) != set(tot): continue
    D.append((r["y"], r["n"], tot, pl, pos, v["lines"], r["fin"], r.get("o"), r.get("p3f"), r["id"] in SS))
print("レース", len(D))
MODES = {"ライン全員": lambda pos: pos != 99, "先頭と番手": lambda pos: pos in (0, 1), "先頭だけ": lambda pos: pos == 0}
def ev(a, mode, yrs):
    f = MODES[mode]; n = w = t3 = 0; hn = hw = 0; hp = 0.0
    for y, nc, tot, pl, pos, L, fin, o, p3f, ss in D:
        if y not in yrs: continue
        s = {c: t + (a * pl[c] if f(pos[c]) else 0) for c, t in tot.items()}
        rk = sorted(s, key=lambda c: (-s[c], c)); n += 1; w += rk[0] == fin[0]; t3 += set(rk[:3]) == set(fin)
        # 🔥: 9車・単騎1人以下・SS無し・本命ライン(◎のライン)の先頭3人・3連複5〜15倍
        if nc >= 8 and not ss and o and sum(len(x) == 1 for x in L) <= 1:
            ln = next(x for x in L if rk[0] in x)
            if len(ln) >= 3:
                t = tuple(sorted(ln[:3])); T = feat.TRIOS[nc]
                if t in T and o[T.index(t)] and 5 <= o[T.index(t)] <= 15:
                    od = o[T.index(t)]; win = t == tuple(sorted(fin)); hn += 1; hw += win
                    hp += (p3f[1] if p3f and p3f[0] == "=".join(map(str, t)) else od * 100) if win else 0
    return f"◎1着 {100*w/n:5.2f}% 上位3人 {100*t3/n:5.2f}% | 🔥 {hn}R 的中{100*hw/max(1,hn):4.1f}% 回収{hp/max(1,hn):5.1f}% 収支{hp-100*hn:+,.0f}"
TR, TE = {2022, 2023, 2024}, {2025, 2026}
print("いま              学習(22-24):", ev(0, "ライン全員", TR), "\n                  確認(25-26):", ev(0, "ライン全員", TE))
for mode in MODES:
    for a in [3, 6, 10, 15, 25]:
        print(f"{mode} +{a:>2}×前受け確率 学習:", ev(a, mode, TR), "\n                  確認:", ev(a, mode, TE))

print("\n■ 上位3人の3連複を毎レース買ったときの回収(学習22-24 / 確認25-26)")
def top3roi(a, mode, yrs):
    f = MODES[mode]; n = w = 0; p = 0.0
    for y, nc, tot, pl, pos, L, fin, o, p3f, ss in D:
        if y not in yrs or not o: continue
        s = {c: t + (a * pl[c] if f(pos[c]) else 0) for c, t in tot.items()}
        t = tuple(sorted(sorted(s, key=lambda c: (-s[c], c))[:3])); T = feat.TRIOS[nc]
        if t not in T or not o[T.index(t)]: continue
        win = t == tuple(sorted(fin)); n += 1; w += win
        p += (p3f[1] if p3f and p3f[0] == "=".join(map(str, t)) else o[T.index(t)] * 100) if win else 0
    return f"{n}R 的中{100*w/n:.2f}% 回収{p/n:.1f}%"
for mode, a in [("ライン全員", 0), ("ライン全員", 10), ("ライン全員", 25), ("先頭だけ", 10), ("先頭だけ", 25)]:
    print(f"  {mode} +{a}: 学習 {top3roi(a, mode, TR)} / 確認 {top3roi(a, mode, TE)}")
