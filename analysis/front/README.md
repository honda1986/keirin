# 初手の前受け（どのラインが前を取るか）の予想（hikitsugi §4-16）

はむさんの依頼「ラインの中身は取得した並びで本番も間違いないが、ライン毎の並び順（前後）は本番と違うことがある。そこを予想して」（2026-09-29）。

- 正解: Kドリームスの結果の表の **S（スタートを取った選手）** のライン = 本番の前受け。`raceres.js` で集めた raceres ブランチの `res-YYYYMM.json`
- 出走表側: pastcard の pcraw を読み直した `cards.jsonl`（ラインの並び順・選手ごとの脚質・S・B・着度数・得点・評価順位）
- パスは作業ディレクトリ（`res/`, `../rv`, `../pc`）に合わせてある

```
python3 front.py res        # 年ごとに「並び予想の先頭ラインが本当に前受けだった割合」と、前の年までで作ったモデル
python3 pf5.py              # その年を抜いた残りの年で作ったモデルで、全レースの線ごとの前受け確率 → pf.json
python3 impact5.py          # 🔥9車5〜15倍を「本命ラインが前受けする確率」で分ける
cd ../rv && python3 pffeat.py races.jsonl pf2225.npy && python3 pffeat.py races26.jsonl pf26.npy && python3 pftest.py   # モデルDに足す
```
