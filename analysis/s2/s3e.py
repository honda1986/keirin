# 3連単の確率(モデル)に 3連複の市場を混ぜる: P(a,b,c) ∝ P_モデル^α × q(3人)^β。α,β は2025年の対数確率で決め、2026年で測る
import sys, json, glob, itertools, pickle, time, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
O3={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
GRID=[(1,0),(1,0.3),(1,0.5),(0.7,0.5),(0.7,0.7),(0.5,0.5),(0.5,0.7),(0,1)]
acc={}
te=sorted(set(RD.ri[RD.year>=2025]))
for s in range(0,len(te),3000):
    P,_=predict(M,te[s:s+3000])
    for ri,g in P.groupby("ri"):
        r=races[ri]; n=r["n"]; o=O3.get(r["id"]); cs=list(itertools.combinations(range(1,n+1),3))
        if not o or len(o["o"])!=len(cs): continue
        q=dict(zip(cs,o["o"])); f=tuple(fin[ri]); fs=tuple(sorted(f))
        A=g.a.values.astype(int); B=g.b.values.astype(int); C=g.c.values.astype(int); pm=g.P.values
        keys=[tuple(sorted(t)) for t in zip(A,B,C)]
        qq=np.array([1/q[k] if q[k] and q[k]<9999 else 1e-6 for k in keys]); qq=qq/qq.sum()*6   # 並びの6通りで割る前の 3人の確率
        S=np.sort(np.c_[A,B,C],axis=1); code=S[:,0]*100+S[:,1]*10+S[:,2]; uc,inv=np.unique(code,return_inverse=True); fcode=fs[0]*100+fs[1]*10+fs[2]
        hit=(A==f[0])&(B==f[1])&(C==f[2])
        for al,be in GRID:
            v=np.exp(al*np.log(np.maximum(pm,1e-12))+be*np.log(qq)); v/=v.sum()
            i=v.argmax(); fk=np.bincount(inv,weights=v); m1=np.bincount(A,weights=v)
            x=acc.setdefault((r["year"],al,be),[0]*7)
            x[0]+=1; x[1]+=hit[i]; x[2]+=uc[fk.argmax()]==fcode; x[3]+=m1.argmax()==f[0]; x[4]+=B[i]==f[1]; x[5]+=C[i]==f[2]
            x[6]+=np.log(max(v[hit].sum(),1e-9))
    print(s,round(time.time()-t0),"秒",flush=True)
best=max(GRID,key=lambda t:acc[(2025,)+t][6]/acc[(2025,)+t][0])
for (al,be) in GRID:
    x=acc[(2026,al,be)]; k=x[0]
    print(f"{'★' if (al,be)==best else ' '} α={al} β={be}: 2026 {k}R ◎1着 {x[3]/k*100:.1f}% ○2着 {x[4]/k*100:.1f}% ▲3着 {x[5]/k*100:.1f}% 3連単1点 {x[1]/k*100:.1f}% 3連複1点 {x[2]/k*100:.1f}% 対数 {x[6]/k:.3f}")
