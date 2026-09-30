# 競り（並び予想のカッコ）の学習（hikitsugi §4-17）

はむさんの指摘（2026-09-30 防府4R「1 ｜ 3 (5 4) (6 2) ｜ 7」）: カッコの中の2人は番手などの位置を競る。

- データ: `nbget.js` で Kドリームスの過去のレース詳細から並び予想を競り付きで取り直した raceres ブランチの `nb-YYYYMM.json`
  （`nb-run` ブランチの pastcard.yml の名前で動かした。nb-run は main に入れない）
- 出走表・評価点・着順は pastcard の `rbss.json`、確定オッズは `races.jsonl` / `races26.jsonl`（作業ディレクトリ `../pc` `../rv`）

```
python3 seri.py      # どれくらいあるか・先頭/カッコの前/後の3着内・1着・🔥との重なり
python3 roi.py       # 競りのレースで単純な買い方の回収率(確定オッズの3連複) / roi_ctl.py は競り無し7車の比較
python3 mark.py      # アプリの◎(評価1位)と競りのラインの先頭のどちらが当たるか
python3 adj.py       # 評価点に 先頭 +a・競る2人 -b/-c を足して並べ直す(2025年で決めて 2022・2026 で確かめる)
cd ../rv && python3 serifeat.py races.jsonl seri2225.npy && python3 serifeat.py races26.jsonl seri26.npy && python3 seritest25.py   # モデルDに足す
```
