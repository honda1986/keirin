# モデルの 1着・2着|1着 に市場(3連複 / 2車単の確定オッズ)を混ぜると当たりはどうなるか。β は2025年で決めて 2026年で測る
import json, glob, pickle, itertools, numpy as np, pandas as pd
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
M,PW,P2=pickle.load(open("base.pkl","rb")); PW=PW.reset_index(drop=True); P2=P2.reset_index(drop=True)
O3={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
O2={}
for f in sorted(glob.glob("o2/o2t-*.json")): O2.update(json.load(open(f))["races"])
fin={ri:[q[0] for q in r["fin"][:3]] for ri,r in enumerate(races)}
pw={(r,c):p for r,c,p in zip(PW.ri,PW.car,PW.pw)}
p2={(r,a,c):p for r,a,c,p in zip(P2.ri,P2.car_1,P2.car,P2.p2)}
D=[]
for ri in sorted(PW.ri.unique()):
    r=races[ri]; n=r["n"]; o3=O3.get(r["id"]); o2=O2.get(r["id"])
    cs=list(itertools.combinations(range(1,n+1),3))
    if not o3 or len(o3["o"])!=len(cs) or not o2 or o2["cars"]!=n or len(o2["o"])!=n*(n-1): continue
    cars=list(range(1,n+1))
    if any((ri,c) not in pw for c in cars): continue
    q3={k:(1/v if v and v<9999 else 0) for k,v in zip(cs,o3["o"])}
    T=np.zeros((n+1,n+1))   # a と b が両方3着以内(3連複の市場)
    for (a,b,c),v in q3.items(): T[a,b]+=v;T[b,a]+=v;T[a,c]+=v;T[c,a]+=v;T[b,c]+=v;T[c,b]+=v
    pairs=[(a,b) for a in cars for b in cars if a!=b]
    Q2=np.zeros((n+1,n+1))
    for (a,b),v in zip(pairs,o2["o"]): Q2[a,b]=1/v if v and v<9999 else 0
    Pm=np.zeros((n+1,n+1)); Wm=np.zeros(n+1)
    for a in cars:
        Wm[a]=pw[(ri,a)]
        for b in cars:
            if a!=b: Pm[a,b]=p2[(ri,a,b)]
    D.append((ri,r["year"],n,fin[ri][0],fin[ri][1],Wm,Pm,T,Q2))
print(len(D),"レース")
def run(b3,b2,bw3,bw2,rows):
    h1=h2c=hex=h2=0; ll=0
    for ri,y,n,f1,f2,Wm,Pm,T,Q2 in rows:
        cars=range(1,n+1)
        # 1着: モデル × 市場の「3着以内に来る」(3連複) ^bw3 × 2車単の1着 ^bw2
        t3=T.sum(1); w2=Q2.sum(1)
        W=np.array([0]+[Wm[a]*max(t3[a],1e-9)**bw3*max(w2[a],1e-9)**bw2 for a in cars]); W/=W.sum()
        P=np.zeros((n+1,n+1))
        for a in cars:
            v=np.array([Pm[a,b]*max(T[a,b],1e-9)**b3*max(Q2[a,b],1e-9)**b2 if b!=a else 0 for b in range(n+1)]); P[a]=v/v.sum()
        J=W[:,None]*P
        h1+=W.argmax()==f1; h2c+=P[f1].argmax()==f2; ll+=np.log(max(P[f1,f2],1e-9))
        i=np.unravel_index(J.argmax(),J.shape); hex+=(i[0],i[1])==(f1,f2); h2+=J.sum(0).argmax()==f2
    k=len(rows); return dict(win=h1/k*100,c2=h2c/k*100,ll=ll/k,ex=hex/k*100,m2=h2/k*100)
r25=[x for x in D if x[1]==2025]; r26=[x for x in D if x[1]==2026]
import random; random.seed(0); s25=random.sample(r25,6000)
fmt=lambda d:f"1着 {d['win']:.1f}% / 2着(1着を知って) {d['c2']:.1f}% 対数{d['ll']:.3f} / 2着率いちばん {d['m2']:.1f}% / 2連単1点 {d['ex']:.1f}%"
print("モデルだけ(2026):",fmt(run(0,0,0,0,r26)),flush=True)
best=max(((b,bw) for b in (0.5,1,1.5,2) for bw in (0.5,1,1.5)),key=lambda t:run(t[0],0,t[1],0,s25)["ll"]+run(t[0],0,t[1],0,s25)["win"]/100)
print("3連複を混ぜる β=",best,"(2026):",fmt(run(best[0],0,best[1],0,r26)),flush=True)
best2=max(((b,bw) for b in (0.5,1,1.5) for bw in (0.5,1,1.5)),key=lambda t:run(0,t[0],0,t[1],s25)["ll"]+run(0,t[0],0,t[1],s25)["win"]/100)
print("2車単を混ぜる β=",best2,"(2026):",fmt(run(0,best2[0],0,best2[1],r26)),flush=True)
print("市場だけ(2車単)(2026):",fmt(run(0,30,0,30,r26)) if False else "")
