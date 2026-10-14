# セオリーを 1着だけでなく 2着・3着でも確かめる(2022〜2026年)。analysis/tenkai をカレントにして python3 ../s2/theory23.py
import json, pickle, subprocess, numpy as np, pandas as pd
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
T=json.loads(subprocess.run(["node","-e","const {T}=require('../../bankdata.js');console.log(JSON.stringify(T))"],capture_output=True,text=True).stdout)
IX=LD.set_index(["ri","li"]); sty=IX["style"].to_dict()
ROLE=["先頭","番手","3番手"]
rows=[]
for ri,r in enumerate(races):
    L=r["lines"]; li={c:i for i,x in enumerate(L) for c in x}
    f=[q[0] for q in r["fin"][:3]]
    if len(f)<3 or any(c not in li for c in f): continue
    def role(c):
        x=L[li[c]]; return "単騎" if len(x)==1 else ROLE[min(x.index(c),2)]
    heads=[i for i,x in enumerate(L) if len(x)>=2]
    nn=sum(1 for i in heads if sty.get((ri,i))==0)
    t=T.get(r["place"],[400,0])
    rows.append(dict(ri=ri,year=r["year"],n=r["n"],nl=len(L),km=r["fin"][0][1],len=t[0],str=t[1],nnige=nn,
        r1=role(f[0]),r2=role(f[1]),r3=role(f[2]),l1=li[f[0]],l2=li[f[1]],l3=li[f[2]],
        s12=li[f[0]]==li[f[1]],s123=li[f[0]]==li[f[1]]==li[f[2]],
        # 2着が1着のすぐ後ろ(番手)/すぐ前(先頭)
        b12=li[f[0]]==li[f[1]] and L[li[f[1]]].index(f[1])==L[li[f[0]]].index(f[0])+1,
        a12=li[f[0]]==li[f[1]] and L[li[f[1]]].index(f[1])==L[li[f[0]]].index(f[0])-1))
D=pd.DataFrame(rows); print(len(D),"レース")
pct=lambda s:round(s.mean()*100,1)
def roles(g,col):
    return pd.DataFrame({k:g[col].apply(lambda s:(s==k).mean()*100).round(1) for k in ["先頭","番手","3番手","単騎"]})
def block(title,key,sub=None):
    d=D if sub is None else sub
    g=d.groupby(key,observed=True)
    print(f"\n■ {title}")
    out=pd.DataFrame({"R":g.size()})
    for i,col in ((1,"r1"),(2,"r2"),(3,"r3")):
        rr=roles(g,col); out[f"{i}着 先頭"]=rr["先頭"]; out[f"{i}着 番手"]=rr["番手"]; out[f"{i}着 3番手"]=rr["3番手"]
    out["1-2着同ライン"]=g.s12.apply(pct); out["1-2-3着同ライン"]=g.s123.apply(pct)
    print(out.to_string())
D["バンク"]=D.len.map(lambda v:"333" if v<=335 else ("500" if v>=500 else "400"))
block("バンクごと(1・2・3着がラインのどこか)","バンク")
D["逃げ型の先頭"]=D.nnige.clip(upper=3).map({0:"0人",1:"1人",2:"2人",3:"3人以上"})
block("逃げ型の先頭の数ごと","逃げ型の先頭",D[D.nl>=3])
# 1着の決まり手ごとに 2着・3着がどこから来るか(スジ)
print("\n■ 1着の決まり手ごとの 2着(1着との関係)")
D["2着"]=np.select([D.b12,D.a12,D.s12],["1着のすぐ後ろ(番手など)","1着のすぐ前(先頭)","1着と同じライン(離れた位置)"],"別のライン")
D["3着が1・2着と同じライン"]=[(a==c or b==c) for a,b,c in zip(D.l1,D.l2,D.l3)]
k=D[D.km.isin(["逃","捲","差"])]
t=pd.crosstab(k.km,k["2着"],normalize="index").mul(100).round(1); t["3着が1・2着どちらかと同じライン"]=k.groupby("km")["3着が1・2着と同じライン"].apply(pct); t["R"]=k.km.value_counts()
print(t.to_string())
# 番手の自力ごとの 1着・2着・3着率
print("\n■ 番手の自力(逃げ+捲りの回数)ごとの 番手の 1着・2着・3着率")
pos={}
for ri,r in enumerate(races):
    for j,q in enumerate(r["fin"][:3]): pos[(ri,q[0])]=j+1
bn=RD[RD.role==1].copy(); bn["jir"]=bn.nige+bn.maku; bn["pos"]=[pos.get((a,b),9) for a,b in zip(bn.ri,bn.car)]
bn["jb"]=pd.cut(bn.jir,[-1,0,2,5,99],labels=["0回","1〜2回","3〜5回","6回以上"]); g=bn.groupby("jb",observed=True)
print(pd.DataFrame({"人":g.size(),"1着%":g.pos.apply(lambda s:(s==1).mean()*100).round(1),"2着%":g.pos.apply(lambda s:(s==2).mean()*100).round(1),
   "3着%":g.pos.apply(lambda s:(s==3).mean()*100).round(1),"3着内%":g.pos.apply(lambda s:(s<=3).mean()*100).round(1)}).to_string())
# 3分戦の形ごと: 注目のラインの選手が 1着・2着・3着になる率(ラインの誰か)
size=IX["size"].to_dict()
def shape(ri):
    s=[sty.get((ri,i),9) for i in range(3)]
    if not all(size.get((ri,i),0)>=2 for i in range(3)): return None,None
    if s.count(0)==2: return "逃げ型2人+もう1人",[i for i in range(3) if s[i]!=0][0]
    if s.count(0)==1 and s.count(2)==2: return "捲り型2人+逃げ型1人",s.index(0)
    return None,None
t3=D[D.nl==3].copy(); sh=t3.ri.map(shape); t3["形"]=[x[0] for x in sh]; t3["注目"]=[x[1] for x in sh]; t3=t3[t3["形"].notna()]
print("\n■ 3分戦の形ごと: 注目のライン(逃げ型2人なら残りの1ライン・捲り型2人なら逃げ型のライン)から 1着・2着・3着が出る率(平均は33%)")
for nm,g in t3.groupby("形"):
    print(f"  {nm} {len(g)}R: 1着 {pct(g.l1==g['注目'])}% / 2着 {pct(g.l2==g['注目'])}% / 3着 {pct(g.l3==g['注目'])}% / 3着以内に1人以上 {pct((g.l1==g['注目'])|(g.l2==g['注目'])|(g.l3==g['注目']))}%")
