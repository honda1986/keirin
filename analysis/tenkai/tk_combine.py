import numpy as np, pickle
exec(open("fitc.py").read().split("tr=ry<=2024")[0])   # X, W, G, ODD, ry, fit, predict, MK, RF
IDS,TK=pickle.load(open("trio_ids.pkl","rb")); IDS=np.array(IDS)
F=pickle.load(open("tk_folds.pkl","rb"))
rid=IDS[G]
cars=np.array([list(map(int,t.split("="))) for t in TK])
def tkfeat(fold):
    d=F[fold]; f1=np.full(len(X),np.nan); f2=np.full(len(X),np.nan)
    for k in range(3):
        pw=np.array([d.get((r,c),(np.nan,np.nan))[0] for r,c in zip(rid,cars[:,k])]); pt=np.array([d.get((r,c),(np.nan,np.nan))[1] for r,c in zip(rid,cars[:,k])])
        f1=np.where(k==0,np.log(np.clip(pt,1e-4,1)),f1+np.log(np.clip(pt,1e-4,1))); f2=np.where(k==0,pw,f2+pw)
    return f1, np.log(np.clip(f2,1e-4,1))
res=[]
for fold,cl_year,tests in [((2022,),2023,[2024]),((2022,2023),2024,[2025,2026])]:
    f1,f2=tkfeat(fold)
    ok_row=~np.isnan(f1)
    # レース単位で全部の組に特徴がそろうものだけ
    bad=np.zeros(G.max()+1,bool); np.logical_or.at(bad,G,~ok_row); ok=~bad[G]
    Xs=np.column_stack([X,np.nan_to_num(f1),np.nan_to_num(f2)])
    globals()["X"]=Xs
    TKC=[Xs.shape[1]-2,Xs.shape[1]-1]
    models={"D(前の年全部)":(MK+RF,np.isin(ry,list(range(2022,cl_year+1)))),
            "D(1年だけ)":(MK+RF,(ry==cl_year)&ok),
            "D+展開(1年だけ)":(MK+RF+TKC,(ry==cl_year)&ok)}
    fitted={k:(c,fit(c,m)[0]) for k,(c,m) in models.items()}
    for ty in tests:
        m=(ry==ty)&ok
        for name,(c,b) in fitted.items():
            p,_,_=predict(c,b,m); od=ODD[m]; w=W[m]; ev=p*od
            line=f"{ty} {name:14s} 当たり組の平均対数確率 {np.log(p[w]).mean():.4f}"
            for th,hi in ((1.05,20),(1.10,30),(1.10,20)):
                s=(ev>=th)&(od<=hi); pts=s.sum(); pay=(od[s&w]*100).sum()
                line+=f" | 期待値{th:.2f}+・{hi}倍以下 {pts}点 的中{(s&w).sum()/max(pts,1)*100:.1f}% 回収{pay/max(pts,1):.0f}% 収支{pay-pts*100:+,.0f}"
            print(line, flush=True)
    globals()["X"]=Xs[:,:-2]
