# 離れる確率を全レースに付けて(学習年は年ごとに交差)、展開＋順番予想に足すと当たりが増えるか
import json, numpy as np, pandas as pd, pickle, time
from sklearn.ensemble import HistGradientBoostingClassifier as GB
import tkcore as T
t0=time.time()
d=pd.read_pickle("hanare.pkl"); m0,F=pickle.load(open("hanare_m.pkl","rb"))
def gbm(): return GB(max_iter=200,learning_rate=0.06,max_leaf_nodes=15,min_samples_leaf=100,l2_regularization=1.0,random_state=0)
def style(nige,maku):
    J=nige+maku; return 3 if J<=2 else (0 if nige/J>=0.6 else (2 if nige/J<=0.4 else 1))
# 全レースの追走者の特徴(hanare.py と同じ)
rows=[]
for ri,r in enumerate(T.races):
    R={int(k):v for k,v in r["R"].items()}; L=r["lines"]
    sc=np.array([R[c][7] for c in R],float); m,sd=sc.mean(),(sc.std() or 1); z=lambda c:(R[c][7]-m)/sd
    for i,x in enumerate(L):
        if len(x)<2: continue
        h=R[x[0]]
        for k in range(1,len(x)):
            f=x[k]; fr=x[k-1]; q=R[f]; p=R[fr]
            rows.append({"ri":ri,"year":r["year"],"car":f,"behind_of":fr,"k":k,"size":len(x),"pos":i,"nl":len(L),"n":r["n"],"bank":r["bank"],"ks":int(r["klass"]=="s"),
              "f_kyaku":{"逃":0,"両":1,"追":2}.get(q[0],1),"f_mark":q[4],"f_sashi":q[3],"f_nige":q[1],"f_maku":q[2],"f_S":q[5],"f_B":q[6],"f_z":z(f),"f_rank":q[8],"f_san":q[9] or 0,"f_age":q[10],
              "p_kyaku":{"逃":0,"両":1,"追":2}.get(p[0],1),"p_nige":p[1],"p_maku":p[2],"p_B":p[6],"p_z":z(fr),"p_age":p[10],"p_style":style(p[1],p[2]),
              "h_style":style(h[1],h[2]),"h_nige":h[1],"h_maku":h[2],"h_B":h[6],"h_z":z(x[0]),"h_age":h[10],"dz":z(f)-z(fr),"dage":q[10]-p[10]})
A=pd.DataFrame(rows); A["pdet"]=np.nan
for test,train in [([2022],[2023,2024]),([2023],[2022,2024]),([2024],[2022,2023]),([2025,2026],[2022,2023,2024])]:
    m=gbm().fit(d[d.year.isin(train)][F],d[d.year.isin(train)].y); s=A.year.isin(test); A.loc[s,"pdet"]=m.predict_proba(A.loc[s,F])[:,1]
print("離れる確率を付けた",len(A),round(time.time()-t0),"秒",flush=True)
# 選手に: 自分が前から離れる確率 / すぐ後ろの選手が自分から離れる確率。線に: どこかで切れる確率
own=A[["ri","car","pdet"]]; beh=A[["ri","behind_of","pdet"]].rename(columns={"behind_of":"car","pdet":"pdet_b"})
RD=T.RD.merge(own,on=["ri","car"],how="left").merge(beh,on=["ri","car"],how="left").fillna({"pdet":0,"pdet_b":0})
brk=A.groupby(["ri","pos"]).pdet.apply(lambda s:1-np.prod(1-s)).rename("l_brk").reset_index().rename(columns={"pos":"li"})
LD=T.LD.merge(brk,on=["ri","li"],how="left").fillna({"l_brk":0})
te=sorted(set(RD.ri[RD.year>=2025])); rng=np.random.RandomState(0); samp=sorted(rng.choice(te,8000,replace=False))
P=dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15)
base=T.train([2022,2023,2024],P); r0=T.score(T.predict(base,samp)[0])
print(f"今の予想           : 1着{r0['win']:.1f}% 3連単{r0['tan']:.1f}% 3連複{r0['fuku']:.1f}% 対数確率{r0['ll']:.3f}",flush=True)
T.RD=RD; T.LD=LD; T.LA=LD[["ri","li","pos","size","style","h_z"]]
T.FA=T.FA+["l_brk"]; T.FB=T.FB+["l_brk"]; T.RF=T.RF+["pdet","pdet_b"]; T.FC=T.FC+["pdet","pdet_b"]
T.OWN=T.OWN+["pdet","pdet_b"]
T.F2=T.OWN+T.CTX+["role_1","lsize_1","z_1","kyaku_1","maku_1","nige_1","same_1","behind_1","ahead_1","dz_1"]; T.F3=T.F2+["role_2","lsize_2","z_2","kyaku_2","same_2","behind_2","ahead_2","dz_2","same12"]
M=T.train([2022,2023,2024],P); r1=T.score(T.predict(M,samp)[0])
print(f"離れる確率を足した : 1着{r1['win']:.1f}% 3連単{r1['tan']:.1f}% 3連複{r1['fuku']:.1f}% 対数確率{r1['ll']:.3f}  {round(time.time()-t0)}秒")
A.to_pickle("hanare_all.pkl")
