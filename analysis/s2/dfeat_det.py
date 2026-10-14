# モデルDの1組1行(trio.npz)に「離れる確率」の特徴を足す → detfeat.npy
import numpy as np, pandas as pd, pickle, time
t0=time.time()
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
A=pd.read_pickle("hanare_all.pkl")[["ri","car","pdet"]]
IDS,TK=pickle.load(open("trio_ids.pkl","rb")); Z=np.load("trio.npz"); G=Z["G"]
rid={r["id"]:ri for ri,r in enumerate(races)}
pdet={}
for ri,c,p in zip(A.ri,A.car,A.pdet): pdet.setdefault(ri,{})[c]=p
line={}
for ri,c,li in zip(RD.ri,RD.car,RD.li): line.setdefault(ri,{})[c]=li
F=np.full((len(G),4),np.nan,np.float32)   # det_sum, same3×brk, 2人が同じライン×その2人の離れる確率, 1人の離れる確率
st=np.r_[0,np.flatnonzero(np.diff(G))+1]; en=np.r_[st[1:],len(G)]
miss=0
for g,(s,e) in enumerate(zip(st,en)):
    ri=rid.get(IDS[G[s]])
    if ri is None or ri not in line: miss+=1; continue
    pd_=pdet.get(ri,{}); ln=line[ri]
    for i in range(s,e):
        a,b,c=map(int,TK[i].split("="))
        if a not in ln or b not in ln or c not in ln: continue
        p=[pd_.get(a,0.0),pd_.get(b,0.0),pd_.get(c,0.0)]; l=[ln[a],ln[b],ln[c]]
        same3=l[0]==l[1]==l[2]
        F[i,0]=sum(p)
        F[i,1]=(1-(1-p[0])*(1-p[1])*(1-p[2])) if same3 else 0
        if not same3 and len(set(l))==2:
            dup=[x for x in set(l) if l.count(x)==2][0]
            F[i,2]=sum(pp for pp,ll in zip(p,l) if ll==dup); F[i,3]=sum(pp for pp,ll in zip(p,l) if ll!=dup)
        else: F[i,2]=0; F[i,3]=0
print("レースの対応が無い",miss,"組の欠け",np.isnan(F[:,0]).sum(),round(time.time()-t0),"秒")
np.save("detfeat.npy",F)
