# 展開から着順を予想する（hikitsugi §4-24）

アプリの `tenkai.js`（詳細の「展開予想」「予想印」）の学習。① 前受け → ② 主導権（最終バック先頭）→ ③ 1着 → ④ 2着｜1着 → ⑤ 3着｜1・2着。

材料（main には入れない。手元に取り出して使う）:
- `pastcard` ブランチの `pc-YYYYMM.json`（並び・評価順位）と `pcraw-YYYYMM.json.gz`（出走表の文字）→ `pc/` `raw/`
- `raceres` ブランチの `res-YYYYMM.json`（S＝スタートを取った選手・B＝最終バック先頭・着順・決まり手）→ `res/`

```
node extract2.js            # tenkai.jsonl（1レース1行: 並び・選手ごとの戦法と回数・S・B・着順）
python3 tk_model.py         # tk_data.pkl（線と選手の表）
python3 tk_base.py          # 展開の傾向（突っ張る率・捲られる率など。hikitsugi §4-24 の表）
python3 tk_size.py          # 木の大きさと当たり方（2022-24 で作り 2025-26 で試す）
python3 tk_export.py        # 本番: 全部の年で学習 → tenkai-model.json と test/tenkai_fixture.json
node ../../tenkaicheck.js   # tenkai.js と Python の突き合わせ（リポジトリの直下で node tenkaicheck.js）
```

モデルD と組み合わせる検証（儲けは増えなかった）:
`extract.js`・`feat.py`・`xfit.py`・`trio.py`（1組1行の表 trio.npz）→ `tk_folds.py`（前の年だけで作った展開）→ `tk_combine.py`、`seq_d.py`（順番予想の3連複の確率を D に足す）。
`fitc.py` はモデルD（市場＋選手）を作り直して比べる条件付きロジット。

- 木は sklearn の HistGradientBoostingClassifier（150回・15葉）。`tenkai.js` は同じ木を JSON から計算する（差 1e-7）
- 特徴の作り方は `tkcore.py`（学習）と `tenkai.js`（アプリ）で同じにしてある。片方だけ変えないこと

## ラインで前について行けない（離れる）確率（hikitsugi §4-25）
```
python3 hanare.py          # 勝敗因が全員にあるレースの追走者に「離れた」を付け、傾向とモデル（2022-24→2025-26）
python3 hanare_use.py      # 全レースに年ごと交差で付けて、展開＋順番予想に足す → 当たりは変わらず
python3 hanare_bet.py      # 本命ライン3人・🔥9車5〜15倍を「切れる確率」で分けた回収
python3 hanare_why.py      # 先頭−番手の得点差との重なり
python3 hanare_export.py   # 本番: tenkai-model.json に models.D・fixture に期待値
```
