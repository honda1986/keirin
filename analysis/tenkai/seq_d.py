# 順番に予想した3連複の確率を、モデルDに足すと儲けが増えるか(2025年で学習 → 2026年で試す)
import numpy as np, pandas as pd, pickle
exec(open("fitc.py").read().split("tr=ry<=2024")[0])
IDS,TK=pickle.load(open("trio_ids.pkl","rb")); IDS=np.array(IDS)
races,_,_=pickle.load(open("tk_data.pkl","rb"))
P=pd.read_pickle("seq_P.pkl"); P["id"]=[races[i]["id"] for i in P.ri]
P["t"]=["=".join(map(str,sorted(x))) for x in zip(P.a,P.b,P.c)]
PT=P.groupby(["id","t"]).P.sum()
key=pd.MultiIndex.from_arrays([IDS[G],np.array(TK)])
f=PT.reindex(key).values
bad=np.zeros(G.max()+1,bool); np.logical_or.at(bad,G,np.isnan(f)); ok=~bad[G]
X=np.column_stack([X,np.log(np.clip(np.nan_to_num(f,nan=1e-6),1e-6,1))])
SQ=[X.shape[1]-1]
models={"D(2022〜25年)":(MK+RF,np.isin(ry,[2022,2023,2024,2025])),"D(2025年だけ)":(MK+RF,(ry==2025)&ok),"D+順番予想(2025年だけ)":(MK+RF+SQ,(ry==2025)&ok)}
m=(ry==2026)&ok
print("2026年のレース数",len(np.unique(G[m])))
for name,(c,msk) in models.items():
    b,_,_=fit(c,msk); p,_,_=predict(c,b,m); od=ODD[m]; w=W[m]; ev=p*od
    line=f"{name:20s} 当たり組の平均対数確率 {np.log(p[w]).mean():.4f}"
    for th,hi in ((1.05,20),(1.10,30),(1.10,20)):
        s=(ev>=th)&(od<=hi); pts=s.sum(); pay=(od[s&w]*100).sum()
        line+=f" | {th:.2f}+・{hi}倍 {pts}点 的中{(s&w).sum()/max(pts,1)*100:.1f}% 回収{pay/max(pts,1):.0f}% {pay-pts*100:+,.0f}円"
    print(line)
    if "順番" in name: print("   順番予想の重み",round(b[-1],3))
# 市場だけ・順番予想だけの当たり方(3連複1点)
