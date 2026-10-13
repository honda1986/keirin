import json, numpy as np, pandas as pd, pickle, glob, itertools
from sklearn.ensemble import HistGradientBoostingClassifier as GB
STY=["逃げ型","両立型","捲り型","自力弱"]
def style(nige,maku):
    J=nige+maku
    return 3 if J<=2 else (0 if nige/J>=0.6 else (2 if nige/J<=0.4 else 1))
races=[]
for l in open("tenkai.jsonl"):
    r=json.loads(l); L=r["lines"]; li={c:i for i,x in enumerate(L) for c in x}
    if r["Sc"] not in li or r["Bc"] not in li or r["fin"][0][0] not in li: continue
    races.append(r)
print("races",len(races))
# ---- 線(ライン)の特徴 ----
LR=[]; RR=[]
for ri,r in enumerate(races):
    L=r["lines"]; R={int(k):v for k,v in r["R"].items()}; nl=len(L)
    sc=np.array([R[c][7] for c in R],float); m,sd=sc.mean(),(sc.std() or 1)
    big=[i for i,x in enumerate(L) if len(x)>=2]; rear=max(big) if big else nl-1
    li={c:i for i,x in enumerate(L) for c in x}; s=li[r["Sc"]]; b=li[r["Bc"]]
    top3=[q[0] for q in r["fin"][:3]]; w=r["fin"][0][0]
    base={"ri":ri,"year":r["year"],"n":r["n"],"nl":nl,"ntank":sum(len(x)==1 for x in L),"bank":r["bank"],"ks":int(r["klass"]=="s"),"seri":int(len(r["seri"])>0)}
    for i,x in enumerate(L):
        h=R[x[0]]; s2=R[x[1]] if len(x)>1 else None
        LR.append({**base,"li":i,"pos":i,"first":int(i==0),"rear":int(i==rear),"size":len(x),"style":style(h[1],h[2]),"h_nige":h[1],"h_maku":h[2],"h_S":h[5],"h_B":h[6],
          "h_z":(h[7]-m)/sd,"h_rank":h[8],"h_kn":int(h[0]=="逃"),"s_oik":int(s2 is not None and s2[0]=="追"),"s_mark":s2[4] if s2 else 0,"s_z":((s2[7]-m)/sd) if s2 else 0,
          "l_best":min(R[c][8] for c in x),"l_z":np.mean([(R[c][7]-m)/sd for c in x[:3]]),"isS":int(i==s),"isB":int(i==b)})
    for i,x in enumerate(L):
        for k,c in enumerate(x):
            q=R[c]
            RR.append({**base,"li":i,"car":c,"role":(3 if len(x)==1 else min(k,2)),"lsize":len(x),"lpos":i,"lrear":int(i==rear),
              "kyaku":{"逃":0,"両":1,"追":2}.get(q[0],1),"nige":q[1],"maku":q[2],"sashi":q[3],"mark":q[4],"S":q[5],"B":q[6],"z":(q[7]-m)/sd,"rank":q[8],"san":q[9] or 0,"age":q[10],
              "lh_style":style(R[x[0]][1],R[x[0]][2]),"lh_z":(R[x[0]][7]-m)/sd,"win":int(c==w),"top3":int(c in top3)})
LD=pd.DataFrame(LR); RD=pd.DataFrame(RR)
pickle.dump((races,LD,RD),open("tk_data.pkl","wb")); print(LD.shape,RD.shape)
