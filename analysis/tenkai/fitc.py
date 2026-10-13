import numpy as np, os, pickle, json
from scipy.optimize import minimize
D=os.path.dirname(os.path.abspath(__file__)); Z=np.load(D+"/trio.npz")
X=Z["X"].astype(np.float64); W=Z["W"]; G=Z["G"]; YR=Z["YR"]; ODD=Z["ODD"].astype(np.float64)
ry=YR[G]
MK=list(range(4)); RF=list(range(4,16)); SF=list(range(16,29))
SFN=["same3","same3×独占確率","two1","two1×2+1確率","1人=番手","1人=逃げの先頭","1人=単騎","1人=その他の先頭","2人=先頭+番手","1人=得点6位以下","1人=◎ライン","three","three×3ライン確率"]
def fit(cols,mask):
    Xs=X[mask][:,cols]; Wm=W[mask]; Gm=G[mask]
    st=np.r_[0,np.flatnonzero(np.diff(Gm))+1]; ln=np.diff(np.r_[st,len(Gm)])
    mu=Xs.mean(0); sd=Xs.std(0); sd[sd==0]=1; Xz=(Xs-mu)/sd
    def f(b):
        u=Xz@b; mx=np.maximum.reduceat(u,st); e=np.exp(u-np.repeat(mx,ln)); s=np.add.reduceat(e,st)
        p=e/np.repeat(s,ln); return -(u[Wm]-mx-np.log(s)).sum()+0.5*1e-3*(b@b), -(Xz.T@(Wm-p))+1e-3*b
    r=minimize(f,np.zeros(len(cols)),jac=True,method="L-BFGS-B",options={"maxiter":3000})
    return r.x/sd, -(mu/sd)@r.x, r
def predict(cols,b,mask):
    Xs=X[mask][:,cols]; Gm=G[mask]; st=np.r_[0,np.flatnonzero(np.diff(Gm))+1]; ln=np.diff(np.r_[st,len(Gm)])
    u=Xs@b; mx=np.maximum.reduceat(u,st); e=np.exp(u-np.repeat(mx,ln)); s=np.add.reduceat(e,st); p=e/np.repeat(s,ln)
    return p, st, ln
tr=ry<=2024
res={}
for name,cols in [("D(市場+選手)",MK+RF),("D+ライン構造",MK+RF+SF)]:
    b,_,r=fit(cols,tr); res[name]=(cols,b); print(name,"学習",r.success,"対数尤度",round(-r.fun,1))
    if name.startswith("D+"):
        for k,v in zip(SFN,b[len(MK+RF):]): print("   %-16s %+.3f"%(k,v))
IDS,TK=pickle.load(open(D+"/trio_ids.pkl","rb"))
out={}
for y in (2025,2026):
    m=ry==y
    for name,(cols,b) in res.items():
        p,st,ln=predict(cols,b,m); w=W[m]; od=ODD[m]
        ll=np.log(p[w]).mean(); ev=p*od
        line=f"{y} {name:14s} 当たり組の平均対数確率 {ll:.4f}"
        for th in (1.05,1.10,1.20):
            sel=(ev>=th)&(od<=20); pts=sel.sum(); hit=(sel&w).sum(); pay=(od[sel&w]*100).sum()
            line+=f" | 期待値{th:.2f}+ {pts}点 的中{hit/pts*100:.1f}% 回収{pay/pts:.0f}%"
        print(line)
        out[(y,name)]=(p,ev)
pickle.dump((res,out),open(D+"/fitc.pkl","wb"))
