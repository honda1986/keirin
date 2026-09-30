# 評価順位(riders[4])を「評価点 + 隊形別の重み × そのラインの前受け確率」で並べ直した races を作る
#   python3 mkfront.py <入力> <出力> <2分戦の重み> <3分戦以上の重み>   (0 0 なら今と同じ作り方の比較用)
import json, sys
PF = json.load(open("../fl/pf.json"))
src, dst, w2, w3 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
n = ch = 0
with open(dst, "w", encoding="utf-8") as out:
    for l in open(src, encoding="utf-8"):
        r = json.loads(l); R = r["riders"]; v = PF.get(r["id"])
        if all(x[5] is not None for x in R):
            k = sum(len(x) >= 2 for x in r["lines"]); w = w2 if k == 2 else w3 if k >= 3 else 0
            pl = {}
            if v and w:
                for ln, p in zip(v["lines"], v["p"]):
                    for c in ln: pl[c] = p
            old = {x[0]: x[4] or 9 for x in R}
            s = {x[0]: x[5] + w * pl.get(x[0], 0) for x in R}
            rk = sorted(s, key=lambda c: (-s[c], old[c], c))
            new = {c: i + 1 for i, c in enumerate(rk)}
            ch += any(new[c] != old[c] for c in new)
            for x in R: x[4] = new[x[0]]
        n += 1; out.write(json.dumps(r, ensure_ascii=False) + "\n")
print(dst, n, "R 順位が変わった", ch)
