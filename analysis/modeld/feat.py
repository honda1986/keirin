# 3連複の全組について特徴を作る(条件付きロジットの材料)。1行=1組
import json, itertools, numpy as np
VENUE_PREF = { "函館": "北海道", "青森": "青森", "いわき平": "福島", "弥彦": "新潟", "前橋": "群馬", "取手": "茨城", "宇都宮": "栃木",
  "大宮": "埼玉", "西武園": "埼玉", "京王閣": "東京", "立川": "東京", "松戸": "千葉", "千葉": "千葉", "川崎": "神奈川", "平塚": "神奈川",
  "小田原": "神奈川", "伊東": "静岡", "静岡": "静岡", "名古屋": "愛知", "岐阜": "岐阜", "大垣": "岐阜", "豊橋": "愛知", "富山": "富山",
  "松阪": "三重", "四日市": "三重", "福井": "福井", "奈良": "奈良", "向日町": "京都", "和歌山": "和歌山", "岸和田": "大阪", "玉野": "岡山",
  "広島": "広島", "防府": "山口", "高松": "香川", "小松島": "徳島", "高知": "高知", "松山": "愛媛", "小倉": "福岡", "久留米": "福岡",
  "武雄": "佐賀", "佐世保": "長崎", "別府": "大分", "熊本": "熊本" }
CUR = { "K": 1.18, "R120_MEAN": 0.42665, "er": 0.05012, "single": -0.06441, "banme": -0.03693, "age50": 0.08587, "home": 0.04772,
  "young": 0.08961, "samepref": 0.03198, "dsc": -0.01254, "has_dsc": 0.02362, "r120": -0.01764, "has_r": -0.30319 }
TRIOS = {n: list(itertools.combinations(range(1, n + 1), 3)) for n in range(3, 10)}

# 選手ごとの特徴(1レース分)。いまの ev.js と同じもの＋候補
RIDER_F = ["er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r", "scz", "head", "srk"]
def rider_feats(r):
    rd = {x[0]: x for x in r["riders"]}
    pos, ln, mates = {}, {}, {}
    for l in r["lines"]:
        for i, c in enumerate(l): pos[c] = i; ln[c] = len(l); mates[c] = [m for m in l if m != c]
    vp = VENUE_PREF.get(r["place"])
    sc = np.array([x[6] or 0 for x in r["riders"]], float); m, s = sc.mean(), sc.std() or 1
    srank = {c: i + 1 for i, c in enumerate(sorted(rd, key=lambda c: -(rd[c][6] or 0)))}
    F = {}
    for c, x in rd.items():
        lp, ll = pos.get(c, 0), ln.get(c, 1)
        san, nr, dsc = x[8], x[9] or 0, x[10]
        hasr = nr > 0 and san is not None
        F[c] = {
            "er": x[4] or 5, "single": 1.0 if ll == 1 else 0.0, "banme": 1.0 if (lp >= 1 and ll >= 2) else 0.0,
            "age50": 1.0 if (x[1] or 0) >= 50 else 0.0, "home": 1.0 if (vp and x[7] == vp) else 0.0,
            "young": 1.0 if (x[2] or 0) >= 121 else 0.0,
            "samepref": 1.0 if (lp >= 1 and any(rd.get(mm) and rd[mm][7] == x[7] for mm in mates.get(c, []))) else 0.0,
            "dsc": float(dsc) if dsc is not None else 0.0, "has_dsc": 1.0 if dsc is not None else 0.0,
            "r120": (san / 100 if hasr else CUR["R120_MEAN"]), "has_r": 1.0 if hasr else 0.0,
            "scz": ((x[6] or m) - m) / s, "head": 1.0 if (lp == 0 and ll >= 2) else 0.0, "srk": srank[c],
        }
    return F, pos, ln

def cur_delta(F):
    return {c: sum(CUR[k] * f[k] for k in ["er", "single", "banme", "age50", "home", "young", "samepref", "dsc", "has_dsc", "r120", "has_r"]) for c, f in F.items()}

TRIO_F = ["line3", "linetop3", "mainTop3", "pair", "mainTop3_9", "mainTop3_solo2", "linetop3_9"]
def race_rows(r):
    """→ (組のリスト, 対数オッズ逆数, 選手特徴の和[組×len(RIDER_F)], 組の特徴[組×len(TRIO_F)], 当たりの添字, いまの δ和, 情報)"""
    n = r["n"]; cs = TRIOS[n]; o = r["o"]
    F, pos, ln = rider_feats(r)
    rank1 = min(F, key=lambda c: F[c]["er"])
    lineOf = {}
    for i, l in enumerate(r["lines"]):
        for c in l: lineOf[c] = i
    main = lineOf.get(rank1)
    solo = sum(1 for l in r["lines"] if len(l) == 1)
    cd = cur_delta(F)
    win = tuple(sorted(r["fin"]))
    keep, lo, RX, TX, cdel = [], [], [], [], []
    wi = -1
    for c, v in zip(cs, o):
        if not (v and 0 < v < 9999): continue
        if c == win: wi = len(keep)
        keep.append(c); lo.append(np.log(1 / v))
        RX.append([F[a][k] + F[b][k] + F[d][k] for k in RIDER_F for (a, b, d) in [c]])
        ls = [lineOf.get(x) for x in c]
        same3 = ls[0] is not None and ls[0] == ls[1] == ls[2]
        top3 = same3 and sorted(pos[x] for x in c) == [0, 1, 2]
        mt = top3 and ls[0] == main
        pairs = sum(1 for i in range(3) for j in range(i + 1, 3) if ls[i] is not None and ls[i] == ls[j])
        TX.append([same3, top3, mt, pairs, mt and n >= 8, mt and solo >= 2, top3 and n >= 8])
        cdel.append(cd[c[0]] + cd[c[1]] + cd[c[2]])
    return keep, np.array(lo), np.array(RX, float), np.array(TX, float), wi, np.array(cdel), {"n": n, "solo": solo, "main": main}
