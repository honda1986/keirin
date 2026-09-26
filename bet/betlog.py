#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""betlog.py -- 1行1イベントで追記するログ

  時刻 / モード / 場・R / 買い目 / 金額 / 結果 / 備考
"""
import os
import sys

from jst import now

SEP = "\t"


class Log:
    def __init__(self, path, mode, echo=True):
        self.path = path
        self.mode = mode
        self.echo = echo

    def _write(self, cols):
        line = SEP.join(str(c) for c in cols)
        if self.echo:
            print(line, flush=True)
        try:
            d = os.path.dirname(os.path.abspath(self.path))
            if d:
                os.makedirs(d, exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError as e:
            print(f"（ログを書けません: {e}）", file=sys.stderr, flush=True)

    def bet(self, b, result, note=""):
        ev = f"期待値{b.ev:.2f}" if b.ev is not None else "期待値-"
        odds = f"{b.odds}倍" if b.odds is not None else "-倍"
        self._write([
            now().strftime("%Y-%m-%d %H:%M:%S"), self.mode, b.label, b.ticket, f"{b.yen}円", result,
            f"締切{b.close}(あと{b.minutes:.1f}分) {ev} {odds} {note}".strip(),
        ])

    def event(self, result, note=""):
        self._write([now().strftime("%Y-%m-%d %H:%M:%S"), self.mode, "-", "-", "-", result, note])
