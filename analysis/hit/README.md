# 的中率の高い買い方の検討（hikitsugi §4-14）

はむさんの依頼「的中率が高い予想モデルを作って（買い方はワイド以外なら何でも）」（2026-09-29）で使ったスクリプト。
analysis/modeld と同じデータ（作り直した出走表 → races.jsonl / races26.jsonl、d2225.npz / d26.npz、cf_{年}_D.npy）と、
odds2 ブランチの2車単・2車複の確定オッズ（o2t-*.json / o2f-*.json）を使う。パスは作業ディレクトリ（../rv, ../pc/o2）に合わせてある。

```
python3 build2.py            # 2車複・2車単の全組の行列 → f2.npz / t2.npz
python3 wf2.py f ; python3 wf2.py t     # 前の年までで学習 → 次の年の確率（条件付きロジット。市場＋選手の特徴＋ラインの関係）
python3 ev2.py f ; python3 ev2.py t     # 1番人気・モデル最有力・期待値で絞った1点の 的中率と回収率
cd ../rv && python3 ../hit/multi3.py    # 3連複を1レース複数点（モデルD）
python3 ../hit/topk.py                  # 3連複 確率上位k点の組み合わせ
PYTHONPATH=. python3 ../hit/dall.py 1.05 20   # 採用した「期待値1.05以上・20倍以下を全部」の年ごと・倍率帯ごと
```
