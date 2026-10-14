# 全レース・年ごと: 1点(3連単・3連複)と、期待値買いの3連複(確率×確定オッズ ≥ しきい値・20倍以下)
import numpy as np, pandas as pd, pickle, json, glob, itertools
races,LD,RD=pickle.load(open("tk_data.pkl","rb"))
H={e["id"]:e for e in json.load(open("/home/user/keirin/history.json"))["entries"]}
OD={}
for f in sorted(glob.glob("/home/user/keirin/odds-202[56]*.json")): OD.update(json.load(open(f))["races"])
def run(mode):
    P=pd.read_pickle(f"fb_P_{mode}_full.pkl"); out={}
    for ri,g in P.groupby("ri",sort=False):
        rc=races[ri]; y=rc["year"]; f=tuple(q[0] for q in rc["fin"][:3]); fs=tuple(sorted(f)); od=OD.get(rc["id"]); h=H.get(rc["id"])
        o=out.setdefault(y,dict(n=0,t3=0,tf=0,nt=0,pt=0,nf=0,pf=0,**{f"b{t}":0 for t in (100,110,120)},**{f"r{t}":0 for t in (100,110,120)}))
        o["n"]+=1
        sq={(int(x.a),int(x.b),int(x.c)):x.P for x in g.itertuples()}; best=max(sq,key=sq.get); o["t3"]+=best==f
        if h and h.get("p3pay") is not None: o["nt"]+=1; o["pt"]+=h["p3pay"] if best==f else 0
        sf={}
        for t,v in sq.items(): k=tuple(sorted(t)); sf[k]=sf.get(k,0)+v
        bf=max(sf,key=sf.get); o["tf"]+=bf==fs
        cs=list(itertools.combinations(range(1,rc["n"]+1),3))
        if od and len(od["o"])==len(cs):
            tri=dict(zip(cs,od["o"])); o["nf"]+=1; o["pf"]+=(tri.get(bf) or 0)*100 if bf==fs else 0
            for k,p in sf.items():
                q=tri.get(k)
                if not q or q>=9999 or q>20: continue
                for t in (100,110,120):
                    if p*q>=t/100: o[f"b{t}"]+=1; o[f"r{t}"]+=q*100 if k==fs else 0
    return out
for mode,lab in (("base","今の予想"),("all","1・2・3着とも最終バック")):
    out=run(mode)
    for y,o in sorted(out.items()):
        print(f"{lab} {y}年 {o['n']}R 3連単{o['t3']/o['n']*100:.1f}%(回収{o['pt']/max(1,o['nt']):.0f}%) 3連複{o['tf']/o['n']*100:.1f}%(回収{o['pf']/max(1,o['nf']):.0f}%) | 期待値≥1.0: {o['b100']}点 {o['r100']/max(1,o['b100']):.0f}% / ≥1.1: {o['b110']}点 {o['r110']/max(1,o['b110']):.0f}% / ≥1.2: {o['b120']}点 {o['r120']/max(1,o['b120']):.0f}%",flush=True)
