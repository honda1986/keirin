# いまのモデルD(市場+選手)を前の年までで作り次の年で試し、買う組(期待値1.05以上・20倍以下)を期待値・倍率で分ける
#   ついでに 7車と9車で別々に作ったら
import sys, numpy as np, pickle, time
from scipy.optimize import minimize
t0=time.time()
Z=np.load("trio.npz"); X=Z["X"].astype(np.float64); W=Z["W"]; G=Z["G"]; YR=Z["YR"]; ODD=Z["ODD"].astype(np.float64)
ry=YR[G]; gsz=np.bincount(G); n=np.round((1+np.sqrt(1+0))*0)  # 組数→車立て
NC={20:6,35:7,56:8,84:9,10:5}; ncar=np.vectorize(lambda k:NC.get(k,0))(gsz)[G]
cols=list(range(16))
def fit(mask):
    Xs=X[mask][:,cols]; Wm=W[mask]; Gm=G[mask]
    st=np.r_[0,np.flatnonzero(np.diff(Gm))+1]; ln=np.diff(np.r_[st,len(Gm)])
    mu=Xs.mean(0); sd=Xs.std(0); sd[sd==0]=1; Xz=(Xs-mu)/sd
    def f(b):
        u=Xz@b; mx=np.maximum.reduceat(u,st); e=np.exp(u-np.repeat(mx,ln)); s=np.add.reduceat(e,st)
        p=e/np.repeat(s,ln); return -(u[Wm]-mx-np.log(s)).sum()+0.5*1e-3*(b@b), -(Xz.T@(Wm-p))+1e-3*b
    return minimize(f,np.zeros(len(cols)),jac=True,method="L-BFGS-B",options={"maxiter":3000}).x/sd
def predict(b,mask):
    Xs=X[mask][:,cols]; Gm=G[mask]; st=np.r_[0,np.flatnonzero(np.diff(Gm))+1]; ln=np.diff(np.r_[st,len(Gm)])
    u=Xs@b; mx=np.maximum.reduceat(u,st); e=np.exp(u-np.repeat(mx,ln)); s=np.add.reduceat(e,st); return e/np.repeat(s,ln)
rows=[]
for y in (2023,2024,2025,2026):
    tr=ry<y; te=ry==y
    p=predict(fit(tr),te); ev=p*ODD[te]
    # 7車・9車で別々
    p2=np.zeros(te.sum()); idx=np.flatnonzero(te)
    for grp in ((ncar<=7),(ncar>=8)):
        m=te&grp; b=fit(tr&grp); p2[np.isin(idx,np.flatnonzero(m))]=predict(b,m)
    ev2=p2*ODD[te]
    for e1,e2,o,w,g,nc in zip(ev,ev2,ODD[te],W[te],G[te],ncar[te]):
        if (e1>=1.05 and o<=20) or (e2>=1.05 and o<=20): rows.append((y,e1,e2,o,w,g,nc))
    print(y,round(time.time()-t0),"秒",flush=True)
pickle.dump(rows,open("dpicks.pkl","wb"))
