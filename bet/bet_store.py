#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bet_store.py -- 投票の記録（bet_done.json）。二重投票を防ぐ、いちばん大事なファイル

- キーは 日付_場_レース（例 20260926_岐阜_3R）。三連複1点なので1レース1件
- ★キーがあれば、何があってもそのレースは買わない
- ★live では「購入する」を押す**直前**に書く。書けなければ押さない。
  押した後に落ちても、次の周で買い直すことが無い（買えていなければ1レース買い逃すだけ）
- 見送りと決めたレースも yen=0 で書く（あとで倍率が動いても、決め直して買わない）
- 書き込みは一時ファイル → os.replace で原子的に
- 起動時に必ず読む。壊れていたら空で続行せず、止まる
"""
import json
import os
import tempfile

from jst import now

VERSION = 1


class BetDoneCorrupt(Exception):
    """bet_done.json が読めない。空で続行してはいけない"""


def make_key(date, place, rno):
    return f"{date}_{place}_{rno}R"


class BetStore:
    def __init__(self, path):
        self.path = path
        self.bets = self._load()

    def _load(self):
        if not os.path.exists(self.path):
            return {}
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
            raise BetDoneCorrupt(f"{self.path} を読めません: {e}")
        if not isinstance(data, dict) or not isinstance(data.get("bets"), dict):
            raise BetDoneCorrupt(f"{self.path} の形が違います（bets が辞書ではない）")
        for key, rec in data["bets"].items():
            if not isinstance(rec, dict) or "yen" not in rec or "date" not in rec:
                raise BetDoneCorrupt(f"{self.path} の {key} が壊れています")
        return data["bets"]

    def has(self, key):
        return key in self.bets

    def keys(self):
        return set(self.bets)

    def spent_on(self, date):
        """その日に使った額（円）。見送り（yen=0）は数えない"""
        return sum(int(r.get("yen") or 0) for r in self.bets.values() if r.get("date") == date)

    def races_on(self, date):
        """その日に買ったレース数"""
        return sum(1 for r in self.bets.values() if r.get("date") == date and int(r.get("yen") or 0) > 0)

    def record(self, bet, mode, yen, note=""):
        """1件ぶん記録して、その場で書き切る。同じキーがあれば例外（二重投票の検知）"""
        if bet.key in self.bets:
            raise RuntimeError(f"二重投票を検知しました: {bet.key}")
        self.bets[bet.key] = {
            "date": bet.date,
            "place": bet.place,
            "rno": bet.rno,
            "ticket": bet.ticket,
            "yen": int(yen),
            "close": bet.close,
            "ev": bet.ev,
            "odds": bet.odds,
            "mode": mode,
            "at": now().strftime("%Y-%m-%d %H:%M:%S"),
            "note": note,
        }
        self._save()

    def set_note(self, key, note):
        if key in self.bets:
            self.bets[key]["note"] = note
            self._save()

    def _save(self):
        d = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".bet_done-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"version": VERSION, "bets": self.bets}, f, ensure_ascii=False, indent=1)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
