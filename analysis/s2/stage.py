# 1着・2着・3着の段ごとにオッズ(3連複)を混ぜる vs いまの「3連単にまとめて混ぜる」。重みは2025年、成績は2026年
#   1着: P1(a) ∝ pw(a)^a1 × M1(a)^b1   M1 = 3連複の市場で a が3着以内に来る確率
#   2着: P2(b|a) ∝ p2(b|a)^a2 × M2(a,b)^b2   M2 = a と b が両方3着以内の確率
#   3着: P3(c|a,b) ∝ p3(c|a,b)^a3 × q(a,b,c)^b3
import sys, json, glob, itertools, pickle, time, numpy as np
sys.path.insert(0,".")
from tkcore import *
t0=time.time()
M,_,_=pickle.load(open("base.pkl","rb"))
O3={}
for f in sorted(glob.glob("../../odds-202[56]*.json")): O3.update(json.load(open(f))["races"])
RACES=[]   # (year, n, f, W[n+1], P2[n+1,n+1], P3[n+1,n+1,n+1], Q[n+1,n+1,n+1])
te=sorted(set(RD.ri[RD.year>=2025]))
for s in range(0,len(te),3000):
    P,pw=predict(M,te[s:s+3000])
    pwd={(r,c):v for r,c,v in zip(pw.ri,pw.car,pw.pw)}
    for ri,g in P.groupby("ri"):
        r=races[ri]; n=r["n"]; o=O3.get(r["id"]); cs=list(itertools.combinations(range(1,n+1),3))
        if not o or len(o["o"])!=len(cs) or len(fin[ri])<3: continue
        J=np.zeros((n+1,n+1,n+1)); J[g.a.values.astype(int),g.b.values.astype(int),g.c.values.astype(int)]=g.P.values
        W=J.sum((1,2)); W2=J.sum(2)
        P2=np.divide(W2,W[:,None],out=np.zeros_like(W2),where=W[:,None]>0); P3=np.divide(J,W2[:,:,None],out=np.zeros_like(J),where=W2[:,:,None]>0)
        q=np.zeros((n+1,n+1,n+1))
        for (a,b,c),v in zip(cs,o["o"]):
            x=1/v if v and v<9999 else 0
            for t in itertools.permutations((a,b,c)): q[t]=x
        q/=q.sum()/6
        RACES.append((r["year"],n,tuple(fin[ri]),W,P2,P3,q))
    print(s,round(time.time()-t0),"秒",flush=True)
L=lambda x:np.log(np.maximum(x,1e-12))
def stage1(W,q,a1,b1): M1=q.sum((1,2)); v=np.exp(a1*L(W)+b1*L(M1)); v[0]=0; v[W==0]=0; return v/v.sum()
def stage2(P2,q,a2,b2): M2=q.sum(2); v=np.exp(a2*L(P2)+b2*L(M2)); v[P2==0]=0; return v/np.maximum(v.sum(1,keepdims=True),1e-300)
def stage3(P3,q,a3,b3): v=np.exp(a3*L(P3)+b3*L(q)); v[P3==0]=0; return v/np.maximum(v.sum(2,keepdims=True),1e-300)
r25=[x for x in RACES if x[0]==2025]; r26=[x for x in RACES if x[0]==2026]
# 段ごとに 2025 の対数確率で重みを選ぶ
def fit(fn,grid,score):
    return max(grid,key=lambda t:np.mean([score(x,fn,t) for x in r25[::3]]))
g1=[(1,b) for b in (0,0.3,0.5,0.8,1,1.5)]+[(0.7,b) for b in (0.5,0.8,1)]
g2=[(1,b) for b in (0,0.2,0.4,0.6,0.8)]+[(0.7,b) for b in (0.4,0.6)]
g3=[(1,b) for b in (0,0.2,0.4,0.6)]+[(0.7,b) for b in (0.4,0.6,0.8)]+[(0.5,b) for b in (0.5,0.7)]
b1=fit(None,g1,lambda x,_,t:np.log(max(stage1(x[3],x[6],*t)[x[2][0]],1e-12)))
b2=fit(None,g2,lambda x,_,t:np.log(max(stage2(x[4],x[6],*t)[x[2][0],x[2][1]],1e-12)))
b3=fit(None,g3,lambda x,_,t:np.log(max(stage3(x[5],x[6],*t)[x[2][0],x[2][1],x[2][2]],1e-12)))
print("段ごとの重み(2025):",b1,b2,b3)
def evalJ(rows,mk):
    h=np.zeros(6); ll=0
    for y,n,f,W,P2,P3,q in rows:
        J=mk(W,P2,P3,q); i=np.unravel_index(J.argmax(),J.shape)
        m1=J.sum((1,2)); fs=tuple(sorted(f))
        S={}; 
        for a in range(1,n+1):
            for b in range(1,n+1):
                for c in range(1,n+1):
                    if J[a,b,c]>0: k=tuple(sorted((a,b,c))); S[k]=S.get(k,0)+J[a,b,c]
        h+=[m1.argmax()==f[0], i[1]==f[1], i[2]==f[2], i==f, max(S,key=S.get)==fs, 0]; ll+=np.log(max(J[f],1e-12))
    k=len(rows); return f"◎1着 {h[0]/k*100:.1f}% ○2着 {h[1]/k*100:.1f}% ▲3着 {h[2]/k*100:.1f}% 3連単 {h[3]/k*100:.1f}% 3連複 {h[4]/k*100:.1f}% 対数 {ll/k:.3f}"
model=lambda W,P2,P3,q: W[:,None,None]*P2[:,:,None]*P3
def tripl(W,P2,P3,q):
    J=model(W,P2,P3,q); v=np.exp(0.7*L(J)+0.5*L(q)); v[J==0]=0; return v/v.sum()
def stagew(W,P2,P3,q): return stage1(W,q,*b1)[:,None,None]*stage2(P2,q,*b2)[:,:,None]*stage3(P3,q,*b3)
print(f"2026 {len(r26)}R")
print("  展開だけ             ",evalJ(r26,model))
print("  いま(3連単にまとめて) ",evalJ(r26,tripl))
print("  段ごとに混ぜる        ",evalJ(r26,stagew))
