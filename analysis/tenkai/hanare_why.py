exec(open("hanare_bet.py").read().split("def show")[0].replace('rows.append({"year"','rows.append({"gap":( (races[ri]["R"][str(ln[0])][7]-races[ri]["R"][str(ln[1])][7]) ), "age2":races[ri]["R"][str(ln[1])][10], "age3":races[ri]["R"][str(ln[2])][10], "year"'))
h=d[d.hot&(d.n>=8)&(d.odds>=5)&(d.odds<=15)].copy()
print("相関: 切れる確率 と 先頭−番手の得点差",round(h[["brk","gap"]].corr().iloc[0,1],2)," / 番手の年齢",round(h[["brk","age2"]].corr().iloc[0,1],2))
for name,col,th in (("先頭−番手の得点差","gap",h.gap.median()),("番手の年齢","age2",h.age2.median())):
    for lab,s in (("上半分",h[h[col]>=th]),("下半分",h[h[col]<th])):
        yr=" ".join(f"{y}:{s[s.year==y].pay.mean():.0f}%" for y in range(2022,2027))
        print(f"  {name}{lab}(境 {th:.1f}): {len(s)}R 的中{s.hit.mean()*100:.1f}% 回収{s.pay.mean():.0f}%  {yr}")
# 両方で分けたとき、切れる確率はまだ効くか
h["g"]=h.gap>=h.gap.median(); h["b"]=h.brk>=0.17
print(h.groupby(["g","b"]).agg(R=("hit","size"),的中=("hit","mean"),回収=("pay","mean")).round(2).to_string())
