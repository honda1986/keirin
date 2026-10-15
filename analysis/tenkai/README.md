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

## 最終バックの並びを予想に足したら（hikitsugi §4-39）
```
python3 fb.py         # 筋書きごとの最終バックの並び（主導権のラインが先頭・残りは周回中の順）を 1着・2着・3着の木に足す。2022-24 で作り 2025-26 の 8,000R で比べる → fb_M.pkl
python3 fb_full.py    # fb_M.pkl で 2025-26 の全レース（今の予想 / 1・2・3着とも最終バック）
python3 fb_eval2.py   # 年ごとの当たり方と回収（1点・期待値買いの3連複）
```
- 結果の表に残っているのは最終バックの「先頭（B）」だけで、2番手から後ろの並びはどこにも無い。並びは決まりから作った（はむさん: 123-45-67 で 67 が押さえると 67-123-45）
- 当たり方は変わらない（対数確率 −4.206 → −4.205）。決まりで作った並びは、前受け・主導権・並び予想の順から決まるので、木がすでに見ている情報しか入っていない

## 前受けのラインが突っ張るか引くか（自分・相手の人数。hikitsugi §4-40）
```
python3 tsup.py       # 突っ張る（前受けのラインが最終バック先頭）率を 自分の人数 × 相手の人数 で。9車/7車・年ごと・先頭の脚質で揃えて → tsup.pkl
python3 tsup_cal.py   # 展開モデル（②・2022-24 で作ったもの。fb.py の fb_M.pkl）の突っ張る確率と 2025-26 の実際を同じ表で比べる
```
