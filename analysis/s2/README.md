# 2着・3連単・モデルD・展開のセオリーの検証（hikitsugi §4-27・§4-28）

`analysis/tenkai/` で `tk_data.pkl`（tk_model.py）・`trio.npz`（trio.py）・`hanare_all.pkl`（hanare_use.py）を作ってから、
**analysis/tenkai をカレントにして** `python3 ../s2/xxx.py` で回す（書き出しも analysis/tenkai に置く）。
2車単・2車複の確定オッズは odds2 ブランチの `o2t-*.json` / `o2f-*.json` を `o2/` に置く。

| スクリプト | 内容 |
|---|---|
| `s2eval.py` | 展開モデルを 2022-24 で作り、2025-26 の 1着率・2着｜1着 を出す（→ base.pkl） |
| `m1.py` | 2着の当たり方（1着を知っているとき・知らないとき）と簡単な決め方との比較 |
| `exp.py` / `exp2.py` | 2着｜1着 に 展開の場面・強さの順位・選手の数字（勝率・2連対率・着の回数・ギヤ・級班）を足す → 変わらず |
| `extra.js` | `node ../s2/extra.js .` 出走表から tenkai.jsonl に無い選手の数字を抜く（extra.json） |
| `mkt.py` / `blend.py` / `top2.py` | 2車単の市場との比較・市場を混ぜる・2着候補を2人にしたら |
| `tan_pred.py` / `tan_eval2.py` | 3連単を k点買うと（3連単の配当は 2026-02 まで1万円以上が抜けているので注意） |
| `dfeat_det.py` / `dfeat_2car.py` / `dfit.py` / `dfit2.py` / `dfit3.py` | モデルDに 離れる確率・2車のオッズを足す、7車/9車別、期待値の帯ごと |
| `theory.py` | サイトでよく言われる展開のセオリーを5年で確かめる |
| `tkx.py` | 展開モデルに 場の特徴（bankdata.js）・先行争い（逃げ型の先頭の数など）を足す → ほぼ変わらず |
| `kimari.py` | 1着の位置（主導権ラインから見て）→ 決まり手 の表と、決まり手の確率の当たり方（tenkai.js の KIMARI） |
