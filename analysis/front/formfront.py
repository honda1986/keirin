# 隊形(2人以上のラインの本数)ごとに: 本番の前受けラインの有利さ / 評価点に前受け確率を足したときの効き方
import json, itertools, collections, sys
sys.path.insert(0, "../rv"); import feat
exec(open("evalfront.py", encoding="utf-8").read().split('print("レース"')[0])   # D を作る部分だけ使う
def form(L):
    k = sum(len(x) >= 2 for x in L); s = sum(len(x) == 1 for x in L)
    return ("2分戦" if k == 2 else "3分戦" if k == 3 else "4分戦以上" if k >= 4 else "ライン1本") + ("" if s == 0 else "+単騎")
# 1. 有利さ(後から分かる本番の前受け。PF の si)
adv = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
for rid, v in PF.items():
    pass
for y, nc, tot, pl, pos, L, fin, o, p3f, ss in D:
    pass
print("■ 1. 本番で前受けしたラインの有利さ(隊形別)")
cnt = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0])
for l in itertools.chain(open("../rv/races.jsonl", encoding="utf-8"), open("../rv/races26.jsonl", encoding="utf-8")):
    r = json.loads(l); v = PF.get(r["id"])
    if not v or v.get("si") is None or not r.get("fin") or len(r["fin"]) < 3: continue
    L = v["lines"]; si = v["si"]; fin = r["fin"]; g = form(L)
    if g.startswith("ライン1本"): continue
    for i, x in enumerate(L):
        if len(x) < 2: continue
        a = cnt[(g, i == si)]; a[0] += 1; a[1] += fin[0] in x; a[2] += x[0] == fin[0]
        a[3] += len(set(x) & set(fin)) >= 2; a[4] += len(x) >= 3 and set(x[:3]) == set(fin)
for g in ["2分戦", "2分戦+単騎", "3分戦", "3分戦+単騎", "4分戦以上", "4分戦以上+単騎"]:
    f, nf = cnt[(g, True)], cnt[(g, False)]
    if not f[0]: continue
    print(f"  {g:<10} 前受け {f[0]:>6}本: ラインから1着 {100*f[1]/f[0]:4.1f}% 先頭1着 {100*f[2]/f[0]:4.1f}% 2人以上3着内 {100*f[3]/f[0]:4.1f}%"
          f" | それ以外 {nf[0]:>6}本: {100*nf[1]/nf[0]:4.1f}% {100*nf[2]/nf[0]:4.1f}% {100*nf[3]/nf[0]:4.1f}%  (1本あたりの平均 {100/ (1+nf[0]/max(1,f[0])):.0f}%)")
# 2. 評価点に足す効き方(隊形別)。学習22-24 / 確認25-26
print("\n■ 2. 評価点に「ライン全員 +a×前受け確率」: 上位3人の3連複の的中 / ◎1着 / 🔥の回収・収支")
def ev2(a, g0, yrs):
    n = w = t3 = 0; hn = hw = 0; hp = 0.0
    for y, nc, tot, pl, pos, L, fin, o, p3f, ss in D:
        if y not in yrs or form(L).split("+")[0] != g0: continue
        s = {c: t + a * pl[c] for c, t in tot.items()}
        rk = sorted(s, key=lambda c: (-s[c], c)); n += 1; w += rk[0] == fin[0]; t3 += set(rk[:3]) == set(fin)
        if nc >= 8 and not ss and o and sum(len(x) == 1 for x in L) <= 1:
            ln = next(x for x in L if rk[0] in x)
            if len(ln) >= 3:
                t = tuple(sorted(ln[:3])); T = feat.TRIOS[nc]
                if t in T and o[T.index(t)] and 5 <= o[T.index(t)] <= 15:
                    win = t == tuple(sorted(fin)); hn += 1; hw += win
                    hp += (p3f[1] if p3f and p3f[0] == "=".join(map(str, t)) else o[T.index(t)] * 100) if win else 0
    return f"{n:>6}R 上位3人 {100*t3/n:5.2f}% ◎1着 {100*w/n:5.2f}% | 🔥 {hn:>4}R 回収{hp/max(1,hn):5.1f}% {hp-100*hn:+7,.0f}"
for g0 in ["2分戦", "3分戦", "4分戦以上"]:
    print(f" [{g0}]")
    for a in [0, 10, 25, 40]:
        print(f"   +{a:>2} 学習 {ev2(a, g0, TR)}\n       確認 {ev2(a, g0, TE)}")
