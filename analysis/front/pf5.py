# 年ごとに「その年を抜いた残りの年」で前受けモデルを作り、各レースの線ごとの前受け確率を出す(pf.json)
import json, numpy as np, flib
rows = flib.rows
yrs = sorted(set(r[0][:4] for r in rows))
PF = {}
for y in yrs:
    b = flib.fit([r for r in rows if r[0][:4] != y])
    for r in rows:
        if r[0][:4] == y:
            PF[r[0]] = {"p": [round(float(x), 4) for x in flib.probs(b, r[1])], "lines": r[4], "rank1": r[5], "si": r[2]}
    print(y, "済", flush=True)
json.dump(PF, open("pf.json", "w"))
acc = np.mean([np.argmax(v["p"]) == v["si"] for v in PF.values()]); base = np.mean([v["si"] == 0 for v in PF.values()])
print("レース", len(PF), f"モデル {100*acc:.1f}% / 並び予想の先頭 {100*base:.1f}%")
