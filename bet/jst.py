#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""jst.py -- 時刻まわり。すべて JST で考える

PC の時計が JST でなくても、絶対時刻さえ合っていれば狂わないように、
固定 +09:00 のタイムゾーンを自分で持つ（JST に夏時間は無い）。
"""
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9), "JST")


def now():
    return datetime.now(JST)


def date_str(dt=None):
    """betplan.js の date と同じ形（"20260926"）"""
    return (dt or now()).strftime("%Y%m%d")


def close_dt(date, close):
    """date("20260926") と close("15:00") から JST の日時を作る。作れなければ None"""
    if not isinstance(date, str) or not isinstance(close, str):
        return None
    try:
        return datetime.strptime(f"{date} {close.strip()}", "%Y%m%d %H:%M").replace(tzinfo=JST)
    except ValueError:
        return None


def minutes_to_close(date, close, at=None):
    """締切まであと何分か。過ぎていれば負。読めなければ None

    大きく負（例 -60 分より小さい）なら「もう過ぎた」として扱えばよく、
    ここでは素直に負の値を返すだけにしておく。
    """
    dt = close_dt(date, close)
    if dt is None:
        return None
    return (dt - (at or now())).total_seconds() / 60.0


def earlier(date, a, b):
    """"HH:MM" 2つのうち早いほう。片方が読めなければもう片方"""
    da, db = close_dt(date, a), close_dt(date, b)
    if da is None:
        return b if db is not None else None
    if db is None:
        return a
    return a if da <= db else b
