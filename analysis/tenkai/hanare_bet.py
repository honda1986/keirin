import json, glob, itertools, numpy as np, pandas as pd, pickle
races,LD,RD=pickle.load(open("tk_data.pkl","rb")); A=pd.read_pickle("hanare_all.pkl")
idx={r["id"]:i for i,r in enumerate(races)}
OD={}
for f in sorted(glob.glob("../../odds-*.json")) or sorted(glob.glob("../../odds-*.json")): OD.update(json.load(open(f))["races"])
PC={}
for f in sorted(glob.glob("pc/pc-*.json")): PC.update(json.load(open(f))["races"])
# ラインの上から3人が切れずに来る確率(番手・3番手が離れない) = (1-p番手)(1-p3番手)
pd_={(a,b):p for a,b,p in zip(A.ri,A.car,A.pdet)}
rows=[]
for id_,x in PC.items():
    ri=idx.get(id_); od=OD.get(id_)
    if ri is None or not od or not x.get("trio"): continue
    r=races[ri]; n=r["n"]; cs=list(itertools.combinations(range(1,n+1),3))
    if len(od["o"])!=len(cs): continue
    o=dict(zip(cs,od["o"])); t=tuple(sorted(x["trio"])); v=o.get(t)
    if not v or v>=9999: continue
    ln=next((l for l in r["lines"] if set(x["trio"])<=set(l)),None)
    if ln is None or len(ln)<3: continue
    keep=(1-pd_.get((ri,ln[1]),0))*(1-pd_.get((ri,ln[2]),0))
    res=tuple(sorted(q[0] for q in r["fin"][:3]))
    rows.append({"year":r["year"],"hot":bool(x.get("hot")),"n":n,"odds":v,"hit":res==t,"pay":v*100 if res==t else 0,"brk":1-keep})
d=pd.DataFrame(rows)
def show(name,s):
    s=s.copy(); s["b"]=pd.qcut(s.brk,4,labels=["切れにくい","やや切れにくい","やや切れやすい","切れやすい"])
    g=s.groupby("b",observed=True).agg(R=("hit","size"),切れる確率=("brk","mean"),的中=("hit","mean"),回収=("pay","mean"))
    for y in range(2022,2027): g[y]=s[s.year==y].groupby("b",observed=True).pay.mean().round(0)
    g["切れる確率"]=(g.切れる確率*100).round(1); g["的中"]=(g.的中*100).round(1); print("\n■",name); print(g.round(0).to_string())
show("本命ライン3人(3連複)・全部",d)
show("🔥 9車・5〜15倍(いまの買い方)",d[d.hot&(d.n>=8)&(d.odds>=5)&(d.odds<=15)])
h=d[d.hot&(d.n>=8)&(d.odds>=5)&(d.odds<=15)].copy()
print("\n🔥 切れる確率の分位ごとの倍率の中央値:", h.groupby(pd.qcut(h.brk,4,labels=False)).odds.median().round(1).tolist())
for th in (0.15,0.17,0.20):
    for name,s in (("以上",h[h.brk>=th]),("未満",h[h.brk<th])):
        yr=" ".join(f"{y}:{s[s.year==y].pay.mean():.0f}%({(s.year==y).sum()})" for y in range(2022,2027))
        print(f"  切れる確率{th:.0%}{name}: {len(s)}R 的中{s.hit.mean()*100:.1f}% 回収{s.pay.mean():.0f}% 収支{s.pay.sum()-len(s)*100:+,.0f}円  {yr}")
# 倍率をそろえて比べる(5〜8・8〜11・11〜15倍で)
h["ob"]=pd.cut(h.odds,[5,8,11,15],include_lowest=True)
print(h.assign(hi=h.brk>=0.17).groupby(["ob","hi"],observed=True).agg(R=("hit","size"),的中=("hit","mean"),回収=("pay","mean")).round(2).to_string())
