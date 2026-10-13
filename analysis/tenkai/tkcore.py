# 展開(前受け→主導権→1着) と 順番予想(2着|1着, 3着|1・2着) をまとめて学習・予想する
import numpy as np, pandas as pd, pickle, itertools
from sklearn.ensemble import HistGradientBoostingClassifier as GB
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
FA=["n","nl","ntank","bank","ks","seri","pos","first","rear","size","style","h_nige","h_maku","h_S","h_B","h_z","h_rank","h_kn","s_oik","s_mark","s_z","l_best","l_z"]
FB=FA+["isS","rel","S_size","S_style","S_hB","S_hnige","S_hz","S_pos"]
RF=["n","nl","ntank","bank","ks","seri","role","lsize","lpos","lrear","kyaku","nige","maku","sashi","mark","S","B","z","rank","san","age","lh_style","lh_z"]
FC=RF+["inS","inB","tsup","relB","B_size","B_style","B_hz","S_size","S_style"]
OWN=["role","lsize","lpos","kyaku","nige","maku","sashi","mark","S","B","z","rank","san","age"]; CTX=["n","nl","ntank","bank","ks"]
F2=OWN+CTX+["role_1","lsize_1","z_1","kyaku_1","maku_1","nige_1","same_1","behind_1","ahead_1","dz_1"]
F3=F2+["role_2","lsize_2","z_2","kyaku_2","same_2","behind_2","ahead_2","dz_2","same12"]
RD=RD.copy(); RD["k"]=RD.groupby(["ri","li"]).cumcount()
LA=LD[["ri","li","pos","size","style","h_z"]]
fin={ri:[q[0] for q in r["fin"][:3]] for ri,r in enumerate(races)}
sb=LD[LD.isS==1][["ri","li"]].rename(columns={"li":"s"}).drop_duplicates("ri").merge(LD[LD.isB==1][["ri","li"]].rename(columns={"li":"b"}).drop_duplicates("ri"),on="ri")
def bframe(L,S):
    Sc=S[["ri","s","pSs","size","style","h_B","h_nige","h_z","pos"]].rename(columns={"size":"S_size","style":"S_style","h_B":"S_hB","h_nige":"S_hnige","h_z":"S_hz","pos":"S_pos"})
    X=L.merge(Sc,on="ri"); X["isS"]=(X.li==X.s).astype(int); X["rel"]=X.pos-X.S_pos; return X
def cframe(R,sc):
    X=R.merge(sc,on="ri")
    X=X.merge(LA.rename(columns={"li":"b","pos":"B_pos","size":"B_size","style":"B_style","h_z":"B_hz"}),on=["ri","b"])
    X=X.merge(LA[["ri","li","size","style"]].rename(columns={"li":"s","size":"S_size","style":"S_style"}),on=["ri","s"])
    X["inS"]=(X.li==X.s).astype(int); X["inB"]=(X.li==X.b).astype(int); X["tsup"]=(X.s==X.b).astype(int); X["relB"]=X.lpos-X.B_pos; return X
def pair(A,C,sfx):
    X=C.merge(A[["ri","car","li","k","role","lsize","z","kyaku","maku","nige"]].rename(columns=lambda c:c if c=="ri" else c+sfx),on="ri")
    X=X[X.car!=X["car"+sfx]].copy()
    X["same"+sfx]=(X.li==X["li"+sfx]).astype(int); X["behind"+sfx]=((X.li==X["li"+sfx])&(X.k==X["k"+sfx]+1)).astype(int)
    X["ahead"+sfx]=((X.li==X["li"+sfx])&(X.k==X["k"+sfx]-1)).astype(int); X["dz"+sfx]=X.z-X["z"+sfx]; return X
def add2(X,B):
    X=X.merge(B[["ri","car","li","k","role","lsize","z","kyaku"]].rename(columns=lambda c:c if c=="ri" else c+"_2"),on="ri") if "car_2" not in X else X
    X=X[(X.car!=X.car_2)].copy()
    X["same_2"]=(X.li==X.li_2).astype(int); X["behind_2"]=((X.li==X.li_2)&(X.k==X.k_2+1)).astype(int); X["ahead_2"]=((X.li==X.li_2)&(X.k==X.k_2-1)).astype(int)
    X["dz_2"]=X.z-X.z_2; X["same12"]=(X.li_1==X.li_2).astype(int); return X
def train(years,params):
    gb=lambda: GB(random_state=0,l2_regularization=1.0,min_samples_leaf=100,**params)
    Lt=LD[LD.year.isin(years)]; Rt=RD[RD.year.isin(years)]
    M={}
    M["A"]=gb().fit(Lt[FA],Lt.isS)
    BX=bframe(Lt,Lt[Lt.isS==1].assign(s=lambda d:d.li,pSs=1.0)); M["B"]=gb().fit(BX[FB],BX.isB)
    X=cframe(Rt,sb.assign(p=1.0)); M["W"]=gb().fit(X[FC],X.win)
    W1=Rt[[c==fin[r][0] for r,c in zip(Rt.ri,Rt.car)]]; W2=Rt[[c==fin[r][1] for r,c in zip(Rt.ri,Rt.car)]]
    X2=pair(W1,Rt,"_1"); X2["y"]=[int(c==fin[r][1]) for r,c in zip(X2.ri,X2.car)]; M["S2"]=gb().fit(X2[F2],X2.y)
    X3=add2(pair(W1,Rt,"_1").merge(W2[["ri","car","li","k","role","lsize","z","kyaku"]].rename(columns=lambda c:c if c=="ri" else c+"_2"),on="ri"),None)
    X3["y"]=[int(c==fin[r][2]) for r,c in zip(X3.ri,X3.car)]; M["S3"]=gb().fit(X3[F3],X3.y)
    return M
def predict(M,ris,chunk=1500):
    """→ 各レースの (1着,2着,3着) の確率 DataFrame[ri,a,b,c,P] と 1着率 pw"""
    outP=[]; outW=[]
    for s in range(0,len(ris),chunk):
        rr=ris[s:s+chunk]; L=LD[LD.ri.isin(rr)].copy(); R=RD[RD.ri.isin(rr)]
        L["pS"]=M["A"].predict_proba(L[FA])[:,1]; L["pS"]/=L.groupby("ri").pS.transform("sum")
        BB=bframe(L.drop(columns=["pS"]),L.assign(s=L.li,pSs=L.pS)); BB["pB"]=M["B"].predict_proba(BB[FB])[:,1]; BB["pB"]/=BB.groupby(["ri","s"]).pB.transform("sum")
        BB["p"]=BB.pSs*BB.pB; sc=BB[BB.p>=0.003][["ri","s","li","p"]].rename(columns={"li":"b"}); sc["p"]/=sc.groupby("ri").p.transform("sum")
        X=cframe(R,sc); X["w"]=M["W"].predict_proba(X[FC])[:,1]; X["w"]=X.w/X.groupby(["ri","s","b"]).w.transform("sum")*X.p
        pw=X.groupby(["ri","car"]).w.sum().rename("pw").reset_index(); outW.append(pw)
        X2=pair(R,R,"_1"); X2["p2"]=M["S2"].predict_proba(X2[F2])[:,1]; X2["p2"]/=X2.groupby(["ri","car_1"]).p2.transform("sum")
        A=X2[["ri","car_1","li_1","car","li","k","role","lsize","z","kyaku","p2"]].rename(columns={"car":"car_2","li":"li_2","k":"k_2","role":"role_2","lsize":"lsize_2","z":"z_2","kyaku":"kyaku_2"})
        X3=add2(pair(R,R,"_1").merge(A,on=["ri","car_1","li_1"]),None); X3["p3"]=M["S3"].predict_proba(X3[F3])[:,1]; X3["p3"]/=X3.groupby(["ri","car_1","car_2"]).p3.transform("sum")
        X3=X3.merge(pw.rename(columns={"car":"car_1"}),on=["ri","car_1"]); X3["P"]=X3.pw*X3.p2*X3.p3
        outP.append(X3[["ri","car_1","car_2","car","P"]].rename(columns={"car_1":"a","car_2":"b","car":"c"}))
    return pd.concat(outP), pd.concat(outW)
def score(P):
    t3=0;tf=0;w1=0;n=0;ll=[]
    for ri,g in P.groupby("ri",sort=False):
        f=tuple(fin[ri]); n+=1
        best=g.loc[g.P.idxmax()]; t=(int(best.a),int(best.b),int(best.c)); t3+=t==f; w1+=t[0]==f[0]
        g=g.assign(key=[tuple(sorted(x)) for x in zip(g.a,g.b,g.c)]); s=g.groupby("key").P.sum(); tf+=s.idxmax()==tuple(sorted(f))
        m=g[(g.a==f[0])&(g.b==f[1])&(g.c==f[2])].P; ll.append(np.log(max(float(m.iloc[0]) if len(m) else 1e-9,1e-9)))
    return dict(races=n,win=w1/n*100,tan=t3/n*100,fuku=tf/n*100,ll=np.mean(ll))
