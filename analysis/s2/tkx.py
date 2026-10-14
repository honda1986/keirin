# 展開モデル(tkcore と同じ形)に、サイトのセオリーから作った特徴を足して比べる。2022-24 で作り 2025-26 で試す
import sys, json, time, pickle, subprocess, numpy as np, pandas as pd
sys.path.insert(0,".")
import tkcore as K
from sklearn.ensemble import HistGradientBoostingClassifier as GB
t0=time.time()
races,LD,RD=K.races,K.LD.copy(),K.RD.copy()
T=json.loads(subprocess.run(["node","-e","const {T}=require('../../bankdata.js');console.log(JSON.stringify(T))"],capture_output=True,text=True).stdout)
# --- 場の特徴(bankdata.js): みなし直線・カント・ドーム・雨・風・逃げ/捲り/差し率・先頭1着率 など ---
TK=["t_str","t_cant","t_dome","t_rain","t_wind","t_nige","t_maku","t_sashi","t_9","t_10","t_11","t_head1","t_13","t_14","t_15"]
place=pd.Series([r["place"] for r in races]); month=pd.Series([int(r["id"][4:6]) for r in races])
tr=pd.DataFrame([T.get(p,[400]+[np.nan]*16)[1:16] for p in place],columns=TK); tr["ri"]=range(len(races)); tr["winter"]=month.isin([12,1,2,3]).astype(int).values
# --- 先行争い: ラインの先頭どうしの比べ合い ---
H=LD[LD["size"]>=2][["ri","li","style","h_nige","h_maku","h_B","h_z"]].copy()
g=H.groupby("ri")
H["nnige"]=g["style"].transform(lambda s:(s==0).sum()); H["nmaku"]=g["style"].transform(lambda s:(s==2).sum())
H["nige_rk"]=g.h_nige.rank(ascending=False,method="min"); H["B_rk"]=g.h_B.rank(ascending=False,method="min"); H["z_rk"]=g.h_z.rank(ascending=False,method="min")
H["nige_gap"]=H.h_nige-g.h_nige.transform(lambda s:s.nlargest(2).iloc[-1] if len(s)>1 else 0)
H["B_gap"]=H.h_B-g.h_B.transform(lambda s:s.nlargest(2).iloc[-1] if len(s)>1 else 0)
CF=["nnige","nmaku","nige_rk","B_rk","z_rk","nige_gap","B_gap"]
LD=LD.merge(H[["ri","li"]+CF],on=["ri","li"],how="left").merge(tr,on="ri",how="left")
race_nn=H.groupby("ri")[["nnige","nmaku"]].first()
LD["nnige"]=LD.ri.map(race_nn.nnige).fillna(0); LD["nmaku"]=LD.ri.map(race_nn.nmaku).fillna(0)
# 選手: 自分のラインの先頭の比べ合い + 場 + 番手の自力
RD=RD.merge(LD[["ri","li","nige_rk","B_rk","z_rk","nige_gap","B_gap"]],on=["ri","li"],how="left").merge(tr,on="ri",how="left")
RD["nnige"]=RD.ri.map(race_nn.nnige).fillna(0); RD["nmaku"]=RD.ri.map(race_nn.nmaku).fillna(0)
RD["jir"]=RD.nige+RD.maku
K.LD,K.RD=LD,RD
K.LA=LD[["ri","li","pos","size","style","h_z"]]
RD["k"]=RD.groupby(["ri","li"]).cumcount(); K.RD=RD
base=dict(FA=K.FA,FB=K.FB,FC=K.FC,F2=K.F2,F3=K.F3)
TS=["t_str","t_cant","t_dome","t_wind","t_nige","t_maku","t_sashi","t_head1","winter"]
VAR={
 "いま":base,
 "+場":dict(FA=K.FA+TS,FB=K.FB+TS,FC=K.FC+TS,F2=K.F2+TS,F3=K.F3+TS),
 "+先行争い":dict(FA=K.FA+CF,FB=K.FB+CF,FC=K.FC+["nnige","nmaku","nige_rk","B_rk","z_rk","nige_gap","B_gap"],F2=K.F2+["nnige","nmaku"],F3=K.F3+["nnige","nmaku"]),
 "+場+先行争い":dict(FA=K.FA+TS+CF,FB=K.FB+TS+CF,FC=K.FC+TS+["nnige","nmaku","nige_rk","B_rk","z_rk","nige_gap","B_gap"],F2=K.F2+TS+["nnige","nmaku"],F3=K.F3+TS+["nnige","nmaku"]),
}
PARAMS=dict(max_iter=150,learning_rate=0.1,max_leaf_nodes=15)
te=sorted(set(RD.ri[RD.year>=2025]))
names=sys.argv[1:] or list(VAR)
for name in names:
    v=VAR[name]; K.FA,K.FB,K.FC,K.F2,K.F3=v["FA"],v["FB"],v["FC"],v["F2"],v["F3"]
    M=K.train([2022,2023,2024],PARAMS)
    # S と B の当たり(いちばん確率の高いライン)
    L=LD[LD.ri.isin(te)].copy(); L["pS"]=M["A"].predict_proba(L[K.FA])[:,1]
    accS=L.loc[L.groupby("ri").pS.idxmax()].isS.mean()*100
    BB=K.bframe(L.drop(columns=["pS"]),L[L.isS==1].assign(s=lambda d:d.li,pSs=1.0)); BB["pB"]=M["B"].predict_proba(BB[K.FB])[:,1]
    accB=BB.loc[BB.groupby("ri").pB.idxmax()].isB.mean()*100
    P,_=K.predict(M,te); r=K.score(P)
    print(f"{name:<10} S(スタート){accS:.1f}% B(主導権|本当のS){accB:.1f}% | 1着{r['win']:.1f}% 3連単{r['tan']:.1f}% 3連複{r['fuku']:.1f}% 対数確率{r['ll']:.4f}  {round(time.time()-t0)}秒",flush=True)
