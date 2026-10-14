# モデルDに特徴を足して、前の年までで作り次の年で試す。python3 dfit.py 2025 [変種...]
import sys, numpy as np, time
from scipy.optimize import minimize
t0=time.time()
Z=np.load("trio.npz"); X=Z["X"].astype(np.float64); W=Z["W"]; G=Z["G"]; YR=Z["YR"]; ODD=Z["ODD"].astype(np.float64)
DF=np.load("detfeat.npy").astype(np.float64)
ok_g=np.ones(len(YR),bool); ok_g[np.unique(G[np.isnan(DF[:,0])])]=False   # 離れる確率が無いレースは比べない
X=np.c_[X,np.nan_to_num(DF)]
ry=YR[G]; okr=ok_g[G]
MK=list(range(4)); RF=list(range(4,16)); SF=list(range(16,29)); DT=list(range(29,33))
V={"いま(市場+選手)":MK+RF,"+離れる確率":MK+RF+DT,"+ライン構造":MK+RF+SF,"+ライン構造+離れる確率":MK+RF+SF+DT}
def fit(cols,mask):
    Xs=X[mask][:,cols]; Wm=W[mask]; Gm=G[mask]
    st=np.r_[0,np.flatnonzero(np.diff(Gm))+1]; ln=np.diff(np.r_[st,len(Gm)])
    mu=Xs.mean(0); sd=Xs.std(0); sd[sd==0]=1; Xz=(Xs-mu)/sd
    def f(b):
        u=Xz@b; mx=np.maximum.reduceat(u,st); e=np.exp(u-np.repeat(mx,ln)); s=np.add.reduceat(e,st)
        p=e/np.repeat(s,ln); return -(u[Wm]-mx-np.log(s)).sum()+0.5*1e-3*(b@b), -(Xz.T@(Wm-p))+1e-3*b
    r=minimize(f,np.zeros(len(cols)),jac=True,method="L-BFGS-B",options={"maxiter":3000})
    return r.x/sd
def predict(cols,b,mask):
    Xs=X[mask][:,cols]; Gm=G[mask]; st=np.r_[0,np.flatnonzero(np.diff(Gm))+1]; ln=np.diff(np.r_[st,len(Gm)])
    u=Xs@b; mx=np.maximum.reduceat(u,st); e=np.exp(u-np.repeat(mx,ln)); s=np.add.reduceat(e,st); return e/np.repeat(s,ln), Gm
y=int(sys.argv[1]); names=sys.argv[2:] or list(V)
tr=(ry<y)&okr; te=(ry==y)&okr
base=None
for name in names:
    cols=V[name]; b=fit(cols,tr); p,gm=predict(cols,b,te); w=W[te]; od=ODD[te]
    ll=np.log(p[w]).sum(); ev=p*od
    if base is None: base=ll
    sel=(ev>=1.05)&(od<=20); pts=sel.sum(); hit=(sel&w).sum(); pay=(od[sel&w]*100).sum(); nr=len(np.unique(gm[sel])); hr=len(np.unique(gm[sel&w]))
    s2=(ev>=1.10)&(od>=10)&(od<=30); pts2=s2.sum(); pay2=(od[s2&w]*100).sum()
    print(f"{y} {name:<20} 対数尤度 {ll-base:+7.1f} | 期待値1.05+・20倍以下 {pts}点 {nr}R 的中{hr/nr*100:.1f}% 回収{pay/pts:.1f}% | 1.10+・10〜30倍 {pts2}点 回収{pay2/pts2:.1f}%  {round(time.time()-t0)}秒",flush=True)
    if len(cols)>16:
        print("     足した係数:",np.round(b[16:],3).tolist())
