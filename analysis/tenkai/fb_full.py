# fb.py のモデル(2022-24 で作ったもの)で 2025-26 の全レースを予想し、年ごとに比べる
import pickle, numpy as np, pandas as pd
src=open("fb.py",encoding="utf-8").read().split('if __name__=="__main__":')[0]; exec(src)
M=pickle.load(open("fb_M.pkl","rb"))
te=sorted(set(RD.ri[RD.year>=2025]))
for mode in ("base","all"):
    P=predictX(M,te,mode); P.to_pickle(f"fb_P_{mode}_full.pkl"); print(mode, score(P), flush=True)
