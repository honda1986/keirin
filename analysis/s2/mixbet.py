# オッズ込みの予想(段ごと・§4-30)で買ったら儲かるか。2022-24 の展開モデル・重みは2025年で決めた(2026年が本当の試験)
#   3連複・2車単・2車複は確定オッズ×100、3連単は history の配当(2026/2まで1万円以上が抜け→的中は1万円で下限)
import sys, json, glob, itertools, pickle, time, numpy as np, pandas as pd
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
O3={};O2T={};O2F={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
for f in sorted(glob.glob("o2/o2t-202[56]*.json")): O2T.update(json.load(open(f))["races"])
for f in sorted(glob.glob("o2/o2f-202[56]*.json")): O2F.update(json.load(open(f))["races"])
H={e["id"]:e for e in json.load(open("../../history.json"))["entries"]}
L=lambda x:np.log(np.maximum(x,1e-12))
def mix(J,q):
    W=J.sum((1,2)); W2=J.sum(2); P2=np.divide(W2,W[:,None],out=np.zeros_like(W2),where=W[:,None]>0); P3=np.divide(J,W2[:,:,None],out=np.zeros_like(J),where=W2[:,:,None]>0)
    v1=np.exp(0.7*L(W)+1.0*L(q.sum((1,2)))); v1[W==0]=0; v1/=v1.sum()
    v2=np.exp(0.7*L(P2)+0.6*L(q.sum(2))); v2[P2==0]=0; v2/=np.maximum(v2.sum(1,keepdims=True),1e-300)
    v3=np.exp(0.5*L(P3)+0.5*L(q)); v3[P3==0]=0; v3/=np.maximum(v3.sum(2,keepdims=True),1e-300)
    return v1[:,None,None]*v2[:,:,None]*v3
rows=[]; trio_rows=[]
te=sorted(set(RD.ri[RD.year>=2025]))
for s in range(0,len(te),3000):
    P,_=predict(M,te[s:s+3000])
    for ri,g in P.groupby("ri"):
        r=races[ri]; n=r["n"]; id_=r["id"]; o=O3.get(id_); cs=list(itertools.combinations(range(1,n+1),3))
        if not o or len(o["o"])!=len(cs) or len(fin[ri])<3: continue
        f=tuple(fin[ri]); fs=tuple(sorted(f))
        J=np.zeros((n+1,)*3); J[g.a.values.astype(int),g.b.values.astype(int),g.c.values.astype(int)]=g.P.values
        q=np.zeros((n+1,)*3); od3={}
        for k,v in zip(cs,o["o"]):
            od3[k]=v if v and v<9999 else None; x=1/v if od3[k] else 0
            for t in itertools.permutations(k): q[t]=x
        q/=q.sum()/6
        Jm=mix(J,q)
        e=H.get(id_,{}); p3=e.get("p3pay")
        for nm,X in (("展開",J),("オッズ込み",Jm)):
            # 3連複の確率(組)と 期待値
            S={k:X[k[0],k[1],k[2]]+X[k[0],k[2],k[1]]+X[k[1],k[0],k[2]]+X[k[1],k[2],k[0]]+X[k[2],k[0],k[1]]+X[k[2],k[1],k[0]] for k in cs}
            top=max(S,key=S.get); i=np.unravel_index(X.argmax(),X.shape)
            ex=X.sum(2); a,b=np.unravel_index(ex.argmax(),ex.shape)
            qn={(x,y):ex[x,y]+ex[y,x] for x in range(1,n+1) for y in range(x+1,n+1)}; qk=max(qn,key=qn.get)
            t2=O2T.get(id_); f2=O2F.get(id_)
            okt=t2 and t2["cars"]==n; okf=f2 and f2["cars"]==n
            dt=dict(zip([(x,y) for x in range(1,n+1) for y in range(1,n+1) if x!=y],t2["o"])) if okt else {}
            df=dict(zip(itertools.combinations(range(1,n+1),2),f2["o"])) if okf else {}
            tanhit=tuple(int(v) for v in i)==f
            rows.append(dict(y=r["year"],d=id_[:8],who=nm,n=n,
                tri=top==fs, p_tri=(od3[top] or 0)*100 if top==fs else 0,
                tan=tanhit, p_tan=(p3 if p3 else (10000 if id_<"20260301" else np.nan)) if tanhit else 0,
                ex=(a,b)==f[:2] if okt else np.nan, p_ex=(dt.get((a,b)) or 0)*100 if okt and (a,b)==f[:2] else 0,
                qn=qk==tuple(sorted(f[:2])) if okf else np.nan, p_qn=(df.get(qk) or 0)*100 if okf and qk==tuple(sorted(f[:2])) else 0))
            for k in cs:
                if od3[k] and od3[k]<=50: trio_rows.append((r["year"],nm,S[k],od3[k],k==fs,id_))
    print(s,round(time.time()-t0),"秒",flush=True)
D=pd.DataFrame(rows); T=pd.DataFrame(trio_rows,columns=["y","who","p","odds","hit","id"])
pickle.dump((D,T),open("mixbet.pkl","wb"))
def roi(d,h,p): d=d[d[h].notna()&d[p].notna()]; return f"的中{d[h].astype(bool).mean()*100:4.1f}% 回収{d[p].sum()/len(d):5.1f}%"
print("\n■ 1点ずつ(年ごと: 2025 / 2026)")
for nm in ("展開","オッズ込み"):
    for k,lab in (("tri","3連複"),("tan","3連単"),("ex","2車単"),("qn","2車複")):
        print(f"  {nm:<6} {lab}: "+" / ".join(f"{y} {roi(D[(D.who==nm)&(D.y==y)],k,'p_'+k)}" for y in (2025,2026)))
print("\n■ 3連複を期待値(確率×確定オッズ)で買う(50倍以下の組から)")
T["ev"]=T.p*T.odds
for nm in ("展開","オッズ込み"):
    for th,hi in ((1.0,20),(1.1,20),(1.2,20),(1.3,30)):
        s=T[(T.who==nm)&(T.ev>=th)&(T.odds<=hi)]
        print(f"  {nm:<6} 期待値{th}以上・{hi}倍以下: "+" / ".join(f"{y} {len(g)}点 的中{g.hit.mean()*100:.1f}% 回収{(g.odds*100*g.hit).sum()/len(g):.0f}%" for y,g in s.groupby("y")))
