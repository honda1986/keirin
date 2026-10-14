# ▲(3着)の選び方を比べる + 市場(3連複)を混ぜる。2022-24 のモデルで 2025-26
import sys, json, glob, itertools, pickle, time, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
O3={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
te=sorted(set(RD.ri[RD.year>=2025])); rows=[]
for s in range(0,len(te),3000):
    P,_=predict(M,te[s:s+3000])
    for ri,g in P.groupby("ri"):
        f=fin[ri]; r=races[ri]; n=r["n"]
        a,b,c=g.loc[g.P.idxmax(),["a","b","c"]].astype(int)
        p3=g.groupby("c").P.sum(); pt=(g.groupby("a").P.sum().add(g.groupby("b").P.sum(),fill_value=0).add(p3,fill_value=0))
        rest=[x for x in pt.index if x not in (a,b)]
        c_p3=max(rest,key=lambda x:p3.get(x,0)); c_pt=max(rest,key=lambda x:pt.get(x,0))
        # ◎○が決まったときの3着(いま) と、◎○のどちらかが外れても3着以内に来やすい選手
        key=g.assign(k=[tuple(sorted(t)) for t in zip(g.a,g.b,g.c)]).groupby("k").P.sum(); fk=key.idxmax()
        top3=sorted(pt.sort_values(ascending=False).index[:3])
        o=O3.get(r["id"]); cs=list(itertools.combinations(range(1,n+1),3))
        mk=None
        if o and len(o["o"])==len(cs):
            q=dict(zip(cs,o["o"])); mk=min(q,key=lambda k:q[k] or 9e9)
        rows.append(dict(ri=ri,a=a,b=b,c=c,c_p3=c_p3,c_pt=c_pt,fk=fk,top3=tuple(top3),mk=mk,f=tuple(f)))
    print(s,round(time.time()-t0),"秒",flush=True)
D=pd.DataFrame(rows)
F=lambda d,col,pos: np.mean([x==fi[pos] for x,fi in zip(d[col],d.f)])*100
T3=lambda d,col: np.mean([x in fi for x,fi in zip(d[col],d.f)])*100
print(f"\n{len(D)}R")
for col,lab in (("c","いま: ◎○が1・2着のときの3着"),("c_p3","3着の確率がいちばん高い(◎○以外)"),("c_pt","3着以内の確率がいちばん高い(◎○以外)")):
    tri=np.mean([tuple(sorted((a,b,x)))==tuple(sorted(fi)) for a,b,x,fi in zip(D.a,D.b,D[col],D.f)])*100
    tan=np.mean([(a,b,x)==fi for a,b,x,fi in zip(D.a,D.b,D[col],D.f)])*100
    print(f"  ▲ = {lab:<26} ▲3着 {F(D,col,2):.1f}% ▲3着以内 {T3(D,col):.1f}% | ◎○▲の3連複 {tri:.1f}% 3連単 {tan:.1f}%")
fk=np.mean([k==tuple(sorted(fi)) for k,fi in zip(D.fk,D.f)])*100; t3=np.mean([k==tuple(sorted(fi)) for k,fi in zip(D.top3,D.f)])*100
m=D[D.mk.notna()]; mk=np.mean([k==tuple(sorted(fi)) for k,fi in zip(m.mk,m.f)])*100
print(f"  3連複1点: 3連複の確率いちばん上 {fk:.1f}% / 3着以内の確率の上位3人 {t3:.1f}% / 市場の1番人気 {mk:.1f}%")
pickle.dump(D,open("s3c.pkl","wb"))
