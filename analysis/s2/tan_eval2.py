# 3連単を何点買うと、的中・回収はどうなるか。全レースを数える(外れは配当が無くても損として数える)
#  A: 2026/4〜9(3連単の配当が全部ある)  B: 2025/1〜2026/2(1万円以上の配当が抜けている → 抜けた的中は1万円として下限)
import json, pickle, numpy as np, pandas as pd
P=pd.read_pickle("tanP.pkl")
H={e["id"]:e for e in json.load(open("../../history.json"))["entries"] if e.get("t")}
P=P[P.id.isin(H)].copy(); P["d"]=P.id.str[:8]
P["hit"]=[(a,b,c)==(H[i]["f"],H[i]["s"],H[i]["t"]) for i,a,b,c in zip(P.id,P.a,P.b,P.c)]
def payof(i,d):
    v=H[i].get("p3pay")
    if v: return v
    return 10000 if d<"20260301" else np.nan
P["pay"]=[payof(i,d) if h else 0 for i,d,h in zip(P.id,P.d,P.hit)]
bad=set(P.ri[P.pay.isna()]); P=P[~P.ri.isin(bad)]
# 印(アプリと同じ: ◎○▲=いちばん確率の高い並び、△×=3着以内の確率の順)
top=P[P.k==1].set_index("ri")[["a","b","c"]]
t3=pd.concat([P[["ri","a","P"]].rename(columns={"a":"car"}),P[["ri","b","P"]].rename(columns={"b":"car"}),P[["ri","c","P"]].rename(columns={"c":"car"})]).groupby(["ri","car"]).P.sum().reset_index()
t3=t3.sort_values(["ri","P"],ascending=[True,False])
marks={}
for ri,g in t3.groupby("ri",sort=False):
    a,b,c=top.loc[ri]; rest=[x for x in g.car if x not in (a,b,c)]; marks[ri]=(a,b,c,*(rest[:2]))
P["m"]=P.ri.map(marks)
def inset(s): return lambda d:[ (x in s(m)) for x,m in zip(zip(d.a,d.b,d.c),d.m)]
import itertools
def form(first,second,third):
    def f(m):
        out=set()
        for x in first(m):
            for y in second(m):
                for z in third(m):
                    if len({x,y,z})==3: out.add((x,y,z))
        return out
    return f
FORMS={
 "◎→○▲→○▲(2点)":form(lambda m:m[:1],lambda m:m[1:3],lambda m:m[1:3]),
 "◎→○▲→○▲△(4点)":form(lambda m:m[:1],lambda m:m[1:3],lambda m:m[1:4]),
 "◎→○▲△→○▲△(6点)":form(lambda m:m[:1],lambda m:m[1:4],lambda m:m[1:4]),
 "◎○▲ボックス(6点)":form(lambda m:m[:3],lambda m:m[:3],lambda m:m[:3]),
 "◎○→◎○▲→◎○▲△(8点)":form(lambda m:m[:2],lambda m:m[:3],lambda m:m[:4]),
 "◎→○▲△×→○▲△×(12点)":form(lambda m:m[:1],lambda m:m[1:5],lambda m:m[1:5]),
}
def stat(S,R,label):
    g=S.groupby("ri").agg(pts=("hit","size"),hit=("hit","max"),pay=("pay","sum")).reindex(R,fill_value=0)
    cost=g.pts.sum()*100; ret=g.pay.sum()
    return f"{label:<24}{g.pts.mean():5.1f}点 的中{g.hit.mean()*100:5.1f}% 回収{ret/cost*100:5.1f}% 1R平均{(ret-cost)/len(g):+6.0f}円"
for name,sel in (("A: 2026/4〜9(配当が全部ある)",P.d>="20260401"),("B: 2025/1〜2026/2(1万円以上は1万円として下限)",P.d<"20260301")):
    S0=P[sel]; R=sorted(S0.ri.unique()); print(f"\n■ {name}  {len(R)}レース")
    for k in (1,2,3,4,5,6,8,10,15,20,30): print("  "+stat(S0[S0.k<=k],R,f"確率の上位{k}点"))
    # フォーメーション(上位40組の外の組は数えない=少しだけ低めに出る)
    for lab,f in FORMS.items():
        keep=[(x in f(m)) for x,m in zip(zip(S0.a,S0.b,S0.c),S0.m)]
        print("  "+stat(S0[keep],R,lab))
# 自信(いちばん上の組の確率)で分けると
print("\n■ いちばん上の組の確率で分ける(A と B を合わせて・B は下限)")
P1=P[P.k==1].set_index("ri").P
P["conf"]=P.ri.map(pd.qcut(P1,5,labels=["低い","やや低い","中","やや高い","高い"]))
for lab,g in P.groupby("conf",observed=True):
    R=sorted(g.ri.unique()); lo,hi=P1.loc[R].min(),P1.loc[R].max()
    print(f" 自信 {lab}({lo*100:.0f}〜{hi*100:.0f}%) {len(R)}R: "+" / ".join(stat(g[g.k<=k],R,f"{k}点").split("点 ",1)[1].replace("1R平均","") .strip() for k in (1,3,6)))
