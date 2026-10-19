# 🔥9車の帯を 5〜15倍 から 20倍以下 などに変えたら(hikitsugi §4-44)。hot2.py が作る hot2.pkl を読む(確定オッズ・払戻 = 倍率×100)
import pickle
D = pickle.load(open("hot2.pkl", "rb"))
b9 = D[(D.n >= 8) & D.hot & ~D.ss & (D.brk >= 0.17)]   # いまの🔥9車(離れる17%以上・SSなし)。帯だけ変える
def show(lab, s):
    yr = " ".join(f"{s[s.y==y].pay.sum()/max(1,(s.y==y).sum()):4.0f}%" for y in range(2022, 2027))
    a, b = s[s.y <= 2024], s[s.y >= 2025]
    print(f"  {lab:<14} {len(s):5d}R 的中{s.hit.mean()*100:4.1f}% 回収{s.pay.sum()/len(s):5.1f}% 収支{int(s.pay.sum()-len(s)*100):+8,d}円 | {yr} | 22-24 {a.pay.sum()/len(a):5.1f}% 25-26 {b.pay.sum()/len(b):5.1f}%")
print("■ 帯(年: 2022 2023 2024 2025 2026)")
for lo, hi in ((5, 15), (0, 20), (5, 20), (0, 15)): show(f"{lo}〜{hi}倍", b9[b9.odds.between(lo, hi)])
show("帯なし", b9)
print("■ 倍率ごと(左を含み右を含まない)")
for lo, hi in ((0, 3), (3, 4), (4, 5), (5, 8), (8, 10), (10, 12), (12, 15), (15, 18), (18, 20), (20, 25), (25, 40), (40, 1e9)):
    show(f"{lo}〜{hi:g}倍" if hi < 1e9 else f"{lo}倍〜", b9[(b9.odds >= lo) & (b9.odds < hi)])
for flag, lab in ((True, "B率1位"), (False, "B率1位以外")):
    print("■", lab); c = b9[b9.headB1 == flag]
    for lo, hi in ((5, 15), (0, 20)): show(f"{lo}〜{hi}倍", c[c.odds.between(lo, hi)])
    show("15倍超〜20倍", c[(c.odds > 15) & (c.odds <= 20)]); show("5倍未満", c[c.odds < 5])
