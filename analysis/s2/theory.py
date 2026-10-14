# サイトで見た展開のセオリーを5年(2022〜2026)の結果で確かめる
import json, pickle, re, numpy as np, pandas as pd, subprocess
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
EX=json.load(open("extra.json"))
T=json.loads(subprocess.run(["node","-e","const {T}=require('../../bankdata.js');console.log(JSON.stringify(T))"],capture_output=True,text=True).stdout)
STY=["逃げ型","両立型","捲り型","自力弱"]
rows=[]
for ri,r in enumerate(races):
    L=r["lines"]; R={int(k):v for k,v in r["R"].items()}
    li={c:i for i,x in enumerate(L) for c in x}
    w=r["fin"][0][0]; km=r["fin"][0][1]; wl=li[w]; wk=L[wl].index(w)
    heads=[x[0] for x in L if len(x)>=2]
    st=LD[LD.ri==ri] if False else None
    rows.append(dict(ri=ri,year=r["year"],place=r["place"],n=r["n"],nl=len(L),km=km,wrole=("単騎" if len(L[wl])==1 else ["先頭","番手","3番手","4番手"][min(wk,3)]),
        S=li[r["Sc"]],B=li[r["Bc"]],wl=wl,month=int(r["id"][4:6])))
D=pd.DataFrame(rows)
IX=LD.set_index(["ri","li"]); sty=IX["style"].to_dict(); size=IX["size"].to_dict()
# 1) 逃げ型の先頭の数(2人以上のラインの先頭)
LD2=LD[LD["size"]>=2]
nn=LD2.groupby("ri")["style"].apply(lambda s:(s==0).sum()).rename("nnige"); D=D.join(nn,on="ri")
D["B_nige"]=[sty.get((ri,b),9)==0 for ri,b in zip(D.ri,D.B)]
D["W_isB"]=D.wl==D.B
print("■1 逃げ型の先頭の数ごと(2人以上のラインの先頭) ※サイト「先行一車は逃げ有利・先行2人はもがき合いで捲り/差し」")
g=D[D.nl>=3].groupby(D.nnige.clip(upper=3))
print(pd.DataFrame({"レース":g.size(),"逃げ1着%":g.km.apply(lambda s:(s=="逃").mean()*100).round(1),"捲り1着%":g.km.apply(lambda s:(s=="捲").mean()*100).round(1),
    "差し1着%":g.km.apply(lambda s:(s=="差").mean()*100).round(1),"バック先頭ラインから1着%":g.W_isB.mean().mul(100).round(1)}).to_string())
# 2) 3分戦で 逃げ型2人+それ以外1人: 逃げ型でないラインの1着率(サイト「逃げそうなラインが2つなら残りの1ラインが買い」)
t3=D[(D.nl==3)].copy()
def third(ri):
    s=[sty.get((ri,i),9) for i in range(3)]; z=[size.get((ri,i),0) for i in range(3)]
    if all(v>=2 for v in z) and sorted(s)[:2]==[0,0] and s.count(0)==2: return [i for i in range(3) if s[i]!=0][0]
    return None
t3["oth"]=t3.ri.map(third); t3=t3[t3.oth.notna()]
print(f"\n■2 3分戦(3人以上のライン3つでなく、2人以上のライン3つ)で逃げ型の先頭2人: {len(t3)}R  逃げ型でないラインから1着 {(t3.wl==t3.oth).mean()*100:.1f}%  (3つのラインの平均 33.3%)")
t3b=D[(D.nl==3)].copy()
def two_maku(ri):
    s=[sty.get((ri,i),9) for i in range(3)]; z=[size.get((ri,i),0) for i in range(3)]
    if all(v>=2 for v in z) and s.count(0)==1 and sum(1 for v in s if v==2)==2: return s.index(0)
    return None
t3b["nl0"]=t3b.ri.map(two_maku); t3b=t3b[t3b.nl0.notna()]
print(f"   捲り型の先頭2人+逃げ型1人: {len(t3b)}R  逃げ型のラインから1着 {(t3b.wl==t3b.nl0).mean()*100:.1f}%  (サイト「捲り2人なら潰し合いで先行有利」)")
# 3) バンクの長さ・みなし直線ごとの決まり手
D["len"]=D.place.map(lambda p:T.get(p,[400])[0]); D["str"]=D.place.map(lambda p:T.get(p,[0,0])[1])
D["strb"]=pd.cut(D.str,[0,45,52,58,70],labels=["〜45m","45〜52m","52〜58m","58m〜"])
for col,lab in (("len","周長"),("strb","みなし直線")):
    g=D.groupby(col,observed=True)
    print(f"\n■3 {lab}ごと ※サイト「33は逃げ有利・500は差し」")
    print(pd.DataFrame({"レース":g.size(),"逃げ%":g.km.apply(lambda s:(s=="逃").mean()*100).round(1),"捲り%":g.km.apply(lambda s:(s=="捲").mean()*100).round(1),
       "差し%":g.km.apply(lambda s:(s=="差").mean()*100).round(1),"1着が先頭%":g.wrole.apply(lambda s:(s=="先頭").mean()*100).round(1),"1着が番手%":g.wrole.apply(lambda s:(s=="番手").mean()*100).round(1)}).to_string())
# 4) 番手に自力がある(逃げ+捲りの回数) → 番手の1着(サイト「二段駆け・番手捲り」)
bn=RD[(RD.role==1)].copy(); bn["jir"]=bn.nige+bn.maku
bn["jb"]=pd.cut(bn.jir,[-1,0,2,5,99],labels=["0回","1〜2回","3〜5回","6回以上"])
g=bn.groupby("jb",observed=True)
print("\n■4 番手の自力(逃げ+捲りの回数)ごとの番手の1着率・3着内率")
print(pd.DataFrame({"人":g.size(),"1着%":g.win.mean().mul(100).round(1),"3着内%":g.top3.mean().mul(100).round(1)}).to_string())
# 5) ギア(先頭)
gear=[]
for ri,r in enumerate(races):
    e=EX.get(r["id"])
    if not e: continue
    for i,x in enumerate(r["lines"]):
        if len(x)>=2 and str(x[0]) in e and e[str(x[0])][7]: gear.append((ri,i,e[str(x[0])][7]))
G=pd.DataFrame(gear,columns=["ri","li","gear"]).merge(LD[["ri","li","isB","isS","style"]],on=["ri","li"])
G["gb"]=pd.cut(G.gear,[0,3.85,3.91,3.93,4.1],labels=["〜3.85","3.86〜3.91","3.92〜3.93","3.94〜"])
g=G.groupby(["style","gb"],observed=True)["isB"].agg(["size","mean"]); g["mean"]=(g["mean"]*100).round(1)
print("\n■5 先頭のギアごとの「最終バック先頭(主導権)」率(脚質別) ※サイト「ギアが大きい先行は逃げ狙い」"); print(g.unstack("gb").to_string())
# 6) 月(季節)×風のある場
D["wind"]=D.place.map(lambda p:T.get(p,[0]*6)[5]); D["windy"]=D.wind>=10
g=D.groupby(["windy",D.month.isin([12,1,2,3])],observed=True)
print("\n■6 風の多い場(風レース率10%以上)×冬(12〜3月)の決まり手")
print(pd.DataFrame({"レース":g.size(),"逃げ%":g.km.apply(lambda s:(s=="逃").mean()*100).round(1),"捲り%":g.km.apply(lambda s:(s=="捲").mean()*100).round(1),"差し%":g.km.apply(lambda s:(s=="差").mean()*100).round(1)}).to_string())
pickle.dump((D,G),open("theory.pkl","wb"))
