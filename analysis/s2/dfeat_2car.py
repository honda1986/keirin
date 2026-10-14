# モデルDの1組1行に「2車複・2車単の市場がその3人をどう見ているか」を足す → f2feat.npy
#   f2: log(3人のうち2人の組(3つ)の 2車複の確率の和)  t2: log(3人の中の並び6通りの 2車単の確率の和)
import json, glob, pickle, itertools, numpy as np, time
t0=time.time()
IDS,TK=pickle.load(open("trio_ids.pkl","rb")); Z=np.load("trio.npz"); G=Z["G"]
F2={};T2={}
for f in sorted(glob.glob("o2/o2f-*.json")): F2.update(json.load(open(f))["races"])
for f in sorted(glob.glob("o2/o2t-*.json")): T2.update(json.load(open(f))["races"])
F=np.full((len(G),2),np.nan,np.float32)
st=np.r_[0,np.flatnonzero(np.diff(G))+1]; en=np.r_[st[1:],len(G)]
ok=0
for s,e in zip(st,en):
    id_=IDS[G[s]]; f2=F2.get(id_); t2=T2.get(id_)
    if not f2 or not t2: continue
    n=f2["cars"]
    if t2["cars"]!=n or len(f2["o"])!=n*(n-1)//2 or len(t2["o"])!=n*(n-1): continue
    pf={k:(1/v if v and v<9999 else 0) for k,v in zip(itertools.combinations(range(1,n+1),2),f2["o"])}
    pt={k:(1/v if v and v<9999 else 0) for k,v in zip([(a,b) for a in range(1,n+1) for b in range(1,n+1) if a!=b],t2["o"])}
    sf=sum(pf.values()) or 1; stt=sum(pt.values()) or 1
    for i in range(s,e):
        a,b,c=map(int,TK[i].split("="))
        F[i,0]=np.log(max((pf.get((a,b),0)+pf.get((a,c),0)+pf.get((b,c),0))/sf,1e-6))
        F[i,1]=np.log(max(sum(pt.get(q,0) for q in itertools.permutations((a,b,c),2))/stt,1e-6))
    ok+=1
print("2車のオッズがあるレース",ok,"/",len(st),round(time.time()-t0),"秒"); np.save("f2feat.npy",F)
