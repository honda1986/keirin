#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""plan_source.py -- keirin の betplan.js を動かして、今日の🔥レースの判定を受け取る

★買うかどうかの判定（🔥・期待値・7車の帯）は Node の betplan.js が、アプリと同じ ev.js で出す。
  ここ（Python）で計算し直さない。式のコピーを増やすと、片方だけ直して食い違う事故になる
  （2026-08-28 に results.js が取り残されて27日間 結果が記録されなかった）。
"""
import json
import os
import subprocess

TIMEOUT = 90


def run(cfg, extra=None):
    """(中身, 取れなかった理由) を返す。落ちない"""
    script = os.path.join(cfg.path("keirin_dir"), "betplan.js")
    if not os.path.exists(script):
        return None, f"betplan.js がありません: {script}（keirin_dir の設定を確かめてください）"
    try:
        p = subprocess.run([cfg.node, script] + list(extra or []), cwd=os.path.dirname(script),
                           capture_output=True, timeout=TIMEOUT, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return None, f"Node が見つかりません（{cfg.node}）。keirin の PC 設定で入れたものです"
    except subprocess.TimeoutExpired:
        return None, f"betplan.js が{TIMEOUT}秒で終わりません（GitHub への接続待ち？）"
    if p.returncode != 0:
        tail = (p.stderr or p.stdout or "").strip().splitlines()[-1:] or ["?"]
        return None, f"betplan.js が失敗: {tail[0]}"
    try:
        data = json.loads((p.stdout or "").strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as e:
        return None, f"betplan.js の出力が読めません: {e}"
    if not isinstance(data, dict) or not isinstance(data.get("races"), list):
        return None, "betplan.js の出力の形が違います"
    return data, ""
