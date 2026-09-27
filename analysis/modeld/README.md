# モデルD の分析（hikitsugi §4-12）

2026-09-27 の見直しで使ったスクリプト。作り直した出走表（pastcard ブランチ）と確定オッズ（odds-YYYYMM.json）、
furoito の着順・配当（★CSV はライセンス不明なので入れない。手元で読むだけ）から作る。

```
git fetch origin pastcard && mkdir -p /tmp/pc && git archive origin/pastcard | tar -x -C /tmp/pc
node pastcard_rebuild.js /tmp/pc <furoito の keirin_data> /tmp/rb.json     # リポジトリの直下で
cd analysis/modeld
node export.js /tmp/rb.json races.jsonl        # 1レース1行（出走表・並び・着順・3連複の全組オッズ）
python3 build.py races.jsonl d2225.npz         # 1組1行の特徴（feat.py）
python3 a1.py                                  # 評価値の当たり方（評価1位・得点1位・市場1位）
python3 hot.py                                 # 🔥の条件を年ごとに
python3 fit2.py                                # モデルの形を比べる（前の年までで学習→次の年で試す）
python3 fit_final.py                           # 本番の係数（evd.js に書く）
python3 hold26.py d26.npz                      # 2026年で最終確認 / sens.py は1レース1点と全部の組の比較
```

- 特徴: 市場（log(1/オッズ) とその2乗・3乗、8車以上の傾き）＋ ev.js v2 の11項目＋競走得点の偏差・順位・ラインの先頭
- 条件付きロジット（レースごとに全組で割り戻す）。`evd.js` と `evdcheck.js` の突き合わせは誤差 1e-14
- numpy / scipy が要る
- `hold26.py` が読む `cf_2026_D.npy`（2025年までで学習した係数）は、`fit2.py` の `fit(VARIANTS["D …"], rowYR <= 2025)` を保存したもの
