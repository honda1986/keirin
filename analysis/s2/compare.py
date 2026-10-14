# 展開予想(2022-24 で作ったモデル)と 今までの予想(評価値の順位) を 2025-26 の同じレースで比べる。市場(1番人気)も並べる
#   ◎○▲: 展開 = 3連単の確率いちばん上の 1着-2着-3着 / 評価値 = 評価順位 1・2・3位
#   回収: 3連複は odds-*.json、2車単・2車複は odds2 ブランチ(o2/)の確定オッズ×100、3連単は history.json の配当(2026/2 まで1万円以上が抜けている→その的中は1万円で下限)
import json, glob, pickle, itertools, numpy as np, pandas as pd
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
TP=pd.read_pickle("tanP.pkl"); top=TP[TP.k==1].set_index("ri")[["a","b","c","id"]]
O3={};O2T={};O2F={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
for f in sorted(glob.glob("o2/o2t-202[56]*.json")): O2T.update(json.load(open(f))["races"])
for f in sorted(glob.glob("o2/o2f-202[56]*.json")): O2F.update(json.load(open(f))["races"])
H={e["id"]:e for e in json.load(open("../../history.json"))["entries"]}
rank=RD.groupby("ri").apply(lambda g:list(g.sort_values("rank").car)).to_dict()
rows=[]
for ri,(a,b,c,id_) in top.iterrows():
    r=races[ri]; n=r["n"]; f=[q[0] for q in r["fin"][:3]]
    if len(f)<3: continue
    o3=O3.get(id_); o2t=O2T.get(id_); o2f=O2F.get(id_)
    if not o3 or len(o3["o"])!=len(list(itertools.combinations(range(1,n+1),3))) or not o2t or o2t["cars"]!=n or not o2f or o2f["cars"]!=n: continue
    q3=dict(zip(itertools.combinations(range(1,n+1),3),o3["o"])); q2t=dict(zip([(x,y) for x in range(1,n+1) for y in range(1,n+1) if x!=y],o2t["o"])); q2f=dict(zip(itertools.combinations(range(1,n+1),2),o2f["o"]))
    rk=rank.get(ri,[])[:3]
    if len(rk)<3: continue
    # 市場: 2車単の1番人気(1着-2着)、3連複の1番人気
    mt=min(q2t,key=lambda k:q2t[k] or 9e9); m3=min(q3,key=lambda k:q3[k] or 9e9)
    w1=min(range(1,n+1),key=lambda x:1/sum(1/q2t[(x,y)] for y in range(1,n+1) if y!=x and q2t[(x,y)]))
    e=H.get(id_,{}); p3=e.get("p3pay")
    tan=lambda t:(p3 if p3 else (10000 if id_<"20260301" else np.nan)) if tuple(t)==tuple(f) else 0
    for nm,(x,y,z) in (("展開",(a,b,c)),("評価値",tuple(rk))):
        k3=tuple(sorted((x,y,z))); k2=tuple(sorted((x,y)))
        rows.append(dict(ri=ri,year=r["year"],n=n,who=nm,
            h1=x==f[0],h2=y==f[1],h3=z==f[2],r1=x in f[:2],t1=x in f,t2=y in f,t3=z in f,
            ex=(x,y)==(f[0],f[1]),qn=k2==tuple(sorted(f[:2])),tri=k3==tuple(sorted(f)),tan=(x,y,z)==tuple(f),
            p_ex=q2t[(x,y)]*100 if (x,y)==(f[0],f[1]) else 0, p_qn=q2f[k2]*100 if k2==tuple(sorted(f[:2])) else 0,
            p_tri=q3[k3]*100 if k3==tuple(sorted(f)) else 0, p_tan=tan((x,y,z)), d=id_[:8]))
    rows.append(dict(ri=ri,year=r["year"],n=n,who="市場の1番人気",h1=w1==f[0],r1=w1 in f[:2],t1=w1 in f,ex=mt==(f[0],f[1]),tri=m3==tuple(sorted(f)),
        p_ex=q2t[mt]*100 if mt==(f[0],f[1]) else 0,p_tri=q3[m3]*100 if m3==tuple(sorted(f)) else 0,d=id_[:8]))
D=pd.DataFrame(rows); D.to_pickle("compare.pkl")
nr=D.ri.nunique(); print(nr,"レース(2025-01〜2026-09・オッズがそろっているもの)")
pc=lambda s:f"{s.mean()*100:.1f}%"
def roi(d,h,p):
    d=d[d[p].notna()]; return f"的中{d[h].mean()*100:4.1f}% 回収{d[p].sum()/len(d):5.1f}%"
for nm in ("展開","評価値","市場の1番人気"):
    d=D[D.who==nm]
    if nm!="市場の1番人気":
        print(f"\n■ {nm}: ◎1着 {pc(d.h1)}・◎2着以内 {pc(d.r1)}・◎3着以内 {pc(d.t1)} / ○2着 {pc(d.h2)}・○3着以内 {pc(d.t2)} / ▲3着 {pc(d.h3)}・▲3着以内 {pc(d.t3)}")
        print(f"   2車単(◎→○) {roi(d,'ex','p_ex')} / 2車複(◎○) {roi(d,'qn','p_qn')} / 3連複(◎○▲) {roi(d,'tri','p_tri')} / 3連単(◎→○→▲) {roi(d,'tan','p_tan')}")
    else:
        print(f"\n■ 市場の1番人気: 1着 {pc(d.h1)}・2着以内 {pc(d.r1)}・3着以内 {pc(d.t1)} / 2車単1番人気 {roi(d,'ex','p_ex')} / 3連複1番人気 {roi(d,'tri','p_tri')}")
# 年・車立てごと
print("\n■ 年・車立てごと(展開 / 評価値)")
for key,lab in (("year","年"),("n","車立て")):
    for v,g in D[D.who!="市場の1番人気"].groupby(key):
        a=g[g.who=="展開"]; b=g[g.who=="評価値"]
        if len(a)<300: continue
        print(f"  {lab}{v}: {len(a)}R  ◎1着 {pc(a.h1)} / {pc(b.h1)}  ○2着 {pc(a.h2)} / {pc(b.h2)}  ▲3着 {pc(a.h3)} / {pc(b.h3)}  3連複 {pc(a.tri)} / {pc(b.tri)}  3連単 {pc(a.tan)} / {pc(b.tan)}")
# ◎が同じか
a=D[D.who=="展開"].set_index("ri"); b=D[D.who=="評価値"].set_index("ri")
same=top.loc[a.index].a.values==np.array([rank[ri][0] for ri in a.index])
print(f"\n■ ◎が同じ {same.mean()*100:.1f}%。違うレースで ◎が1着: 展開 {a.h1[~same].mean()*100:.1f}% / 評価値 {b.h1[~same].mean()*100:.1f}%")
