# ============================================================
# analysis/home/hline.py — バックを取るラインの予測に H が効くか(hline.js の CSV を読む。hikitsugi §4-48)
#
#   M0: engine.js の backProb そのまま(係数は記事027)。H = B(今の予想)
#   M1: 同じ式・同じ係数で H だけ本物
#   M2: 係数を作り直す(H なし: B率・ライン長・得点差・番手が年上)
#   M3: M2 + H率
#   M4: M3 + S率・逃げ率・捲り率
# 作り直しは FROM〜SPLIT の前で学習して SPLIT 以降で確かめる(クラス × 車立ての4区分ごと。engine.js の bkKey と同じ)。
# ★WINTICKET の H は 2026-04 から記録され始めた(2026-03 までは全員 0、2026-05 から9割以上)。H を見るなら FROM=20260501

# 見るもの: レースの中で確率がいちばん高いラインが、実際にバックを取ったラインだった率(的中)と log loss。
#
# 使い方: python3.13 analysis/home/hline.py <hline.js の CSV> [FROM=20260501] [SPLIT=20260801]
# ============================================================
import csv, math, sys
from collections import defaultdict
import numpy as np
from sklearn.linear_model import LogisticRegression

LOGIT = {"s": [0.113, 0.050, 0.556, 0.051, -0.021, -3.416], "a12_9": [0.111, 0.047, 0.671, 0.053, -0.051, -3.764],
         "a12_7": [0.110, 0.064, 0.815, 0.067, 0.046, -3.784], "ch": [0.063, 0.085, 0.902, 0.131, -0.090, -4.112]}

def bk(klass, n):
    return "ch" if klass == "challenge" else "s" if klass == "s" else "a12_9" if n >= 8 else "a12_7"

FROM = sys.argv[2] if len(sys.argv) > 2 else "20260501"
SPLIT = sys.argv[3] if len(sys.argv) > 3 else "20260801"
rows = []
with open(sys.argv[1], encoding="utf-8") as f:
    for r in csv.DictReader(f):
        if r["klass"] == "girls" or r["date"] < FROM:
            continue
        for k in ("bR", "hR", "sR", "nigeR", "makuriR", "gdiff"):
            r[k] = float(r[k])
        for k in ("n", "len", "older", "won", "starts"):
            r[k] = int(r[k])
        r["g"] = bk(r["klass"], r["n"])
        rows.append(r)

def eng(r, realH):
    c = LOGIT[r["g"]]
    x1 = min(21, r["bR"] * 21)
    x2 = min(21, (r["hR"] if realH else r["bR"]) * 21)
    z = c[0] * x1 + c[1] * x2 + c[2] * r["len"] + c[3] * r["gdiff"] + c[4] * r["older"] + c[5]
    return 1 / (1 + math.exp(-z))

FEATS = {"M2": ["bR", "len", "gdiff", "older"], "M3": ["bR", "hR", "len", "gdiff", "older"],
         "M4": ["bR", "hR", "sR", "nigeR", "makuriR", "len", "gdiff", "older"]}

def evaluate(pred, test):
    by = defaultdict(list)
    for r, p in zip(test, pred):
        by[r["id"]].append((p, r["won"]))
    hit = n = 0
    for v in by.values():
        if not any(w for _, w in v):
            continue  # バックを取ったのが単騎など(2人以上のラインではない)
        n += 1
        hit += max(v)[1] == 1
    ll = -np.mean([math.log(max(1e-9, p if r["won"] else 1 - p)) for r, p in zip(test, pred)])
    return hit, n, ll

train = [r for r in rows if r["date"] < SPLIT]
test = [r for r in rows if r["date"] >= SPLIT]
print("ライン", len(rows), "(学習", FROM, "〜", SPLIT, "の前", len(train), "/ 確かめ", SPLIT, "〜", len(test), ")")
for g in ["全体", "s", "a12_9", "a12_7", "ch"]:
    te = [r for r in test if g == "全体" or r["g"] == g]
    if not te:
        continue
    out = []
    for name in ["M0", "M1"]:
        h, n, ll = evaluate([eng(r, name == "M1") for r in te], te)
        out.append(f"{name} {100 * h / n:.1f}% ll{ll:.4f}")
    for name, fs in FEATS.items():
        pred = [0.0] * len(te)
        for gg in (["s", "a12_9", "a12_7", "ch"] if g == "全体" else [g]):
            tr = [r for r in train if r["g"] == gg]
            idx = [i for i, r in enumerate(te) if r["g"] == gg]
            if not tr or not idx:
                continue
            m = LogisticRegression(max_iter=2000).fit(np.array([[r[k] for k in fs] for r in tr]), [r["won"] for r in tr])
            pp = m.predict_proba(np.array([[te[i][k] for k in fs] for i in idx]))[:, 1]
            for i, p in zip(idx, pp):
                pred[i] = p
            if g != "全体" and name == "M4":
                print(f"  [{gg}] M4 の係数", dict(zip(fs, np.round(m.coef_[0], 3))))
        h, n, ll = evaluate(pred, te)
        out.append(f"{name} {100 * h / n:.1f}% ll{ll:.4f}")
    print(f"{g:6s} レース{n:6d}  " + "  ".join(out))
