#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""config.py -- config.json を読んで、値の形を確かめる（競艇の auto_bet と同じ作り）

上限の項目（max_yen_per_day / max_races_per_day）は null で無制限。
"_" で始まるキーは人間向けの覚書なので読み飛ばす。
相対パスは config.json のあるフォルダからの相対として解く。

★ログインID・パスワード・暗証番号の項目はありません。作らないこと。
"""
import json
import os
import shutil
from dataclasses import dataclass, field

DEFAULTS = {
    "i_have_read_the_terms": False,
    "bet_yen": 100,
    "max_yen_per_day": 1000,
    "max_races_per_day": 10,
    "use_ev": True,
    "buy_7car": True,
    "decide_left_minutes": 6.0,
    "max_snap_age_minutes": 4.0,
    "close_min_minutes": 1.5,
    "require_site_close": True,
    "poll_seconds": 20,
    "keepalive_minutes": 10,
    "node": "node",
    "keirin_dir": "..",
    "oddspark_url": "https://www.oddspark.com/",
    "vote_link_index": 2,
    "profile_dir": "chrome_profile",
    "use_installed_chrome": True,
    "headless": False,
    "bet_done_path": "bet_done.json",
    "log_path": "logs/keirin_bet.log",
    "shot_dir": "shots",
    "stop_file": "STOP",
}


class ConfigError(Exception):
    pass


@dataclass
class Config:
    base_dir: str = "."
    i_have_read_the_terms: bool = False
    bet_yen: int = 100
    max_yen_per_day: "int | None" = 1000
    max_races_per_day: "int | None" = 10
    use_ev: bool = True
    buy_7car: bool = True
    decide_left_minutes: float = 6.0
    max_snap_age_minutes: float = 4.0
    close_min_minutes: float = 1.5
    require_site_close: bool = True
    poll_seconds: int = 20
    keepalive_minutes: int = 10
    node: str = "node"
    keirin_dir: str = ".."
    oddspark_url: str = DEFAULTS["oddspark_url"]
    vote_link_index: int = 2
    profile_dir: str = "chrome_profile"
    use_installed_chrome: bool = True
    headless: bool = False
    bet_done_path: str = "bet_done.json"
    log_path: str = "logs/keirin_bet.log"
    shot_dir: str = "shots"
    stop_file: str = "STOP"
    unknown_keys: list = field(default_factory=list)

    def path(self, name):
        """設定に書かれたパスを絶対パスにする"""
        p = getattr(self, name)
        return p if os.path.isabs(p) else os.path.normpath(os.path.join(self.base_dir, p))


def _as_bool(d, key):
    v = d.get(key, DEFAULTS[key])
    if not isinstance(v, bool):
        raise ConfigError(f"{key} は true / false で書いてください（いまは {v!r}）")
    return v


def _as_int(d, key, lo=None, hi=None):
    v = d.get(key, DEFAULTS[key])
    if isinstance(v, bool) or not isinstance(v, int):
        raise ConfigError(f"{key} は整数で書いてください（いまは {v!r}）")
    if lo is not None and v < lo:
        raise ConfigError(f"{key} は {lo} 以上にしてください（いまは {v}）")
    if hi is not None and v > hi:
        raise ConfigError(f"{key} は {hi} 以下にしてください（いまは {v}）")
    return v


def _as_limit(d, key):
    """null なら無制限。数値なら 1 以上"""
    v = d.get(key, DEFAULTS[key])
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int):
        raise ConfigError(f"{key} は整数か null（無制限）で書いてください（いまは {v!r}）")
    if v < 1:
        raise ConfigError(f"{key} は 1 以上か null にしてください（いまは {v}）")
    return v


def _as_num(d, key, lo=None, hi=None):
    v = d.get(key, DEFAULTS[key])
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ConfigError(f"{key} は数値で書いてください（いまは {v!r}）")
    if lo is not None and v < lo:
        raise ConfigError(f"{key} は {lo} 以上にしてください（いまは {v}）")
    if hi is not None and v > hi:
        raise ConfigError(f"{key} は {hi} 以下にしてください（いまは {v}）")
    return float(v)


def _as_str(d, key, required=False):
    v = d.get(key, DEFAULTS[key])
    if not isinstance(v, str):
        raise ConfigError(f"{key} は文字列で書いてください（いまは {v!r}）")
    v = v.strip()
    if required and not v:
        raise ConfigError(f"{key} が空です")
    return v


def from_dict(d, base_dir="."):
    if not isinstance(d, dict):
        raise ConfigError("config.json の中身が辞書ではありません")
    cfg = Config(
        base_dir=base_dir,
        i_have_read_the_terms=_as_bool(d, "i_have_read_the_terms"),
        bet_yen=_as_int(d, "bet_yen", lo=100, hi=10000),
        max_yen_per_day=_as_limit(d, "max_yen_per_day"),
        max_races_per_day=_as_limit(d, "max_races_per_day"),
        use_ev=_as_bool(d, "use_ev"),
        buy_7car=_as_bool(d, "buy_7car"),
        decide_left_minutes=_as_num(d, "decide_left_minutes", lo=2, hi=15),
        max_snap_age_minutes=_as_num(d, "max_snap_age_minutes", lo=1, hi=10),
        close_min_minutes=_as_num(d, "close_min_minutes", lo=0.5, hi=10),
        require_site_close=_as_bool(d, "require_site_close"),
        poll_seconds=_as_int(d, "poll_seconds", lo=10, hi=120),
        keepalive_minutes=_as_int(d, "keepalive_minutes", lo=0),
        node=_as_str(d, "node", required=True),
        keirin_dir=_as_str(d, "keirin_dir", required=True),
        oddspark_url=_as_str(d, "oddspark_url", required=True),
        vote_link_index=_as_int(d, "vote_link_index", lo=0, hi=20),
        profile_dir=_as_str(d, "profile_dir", required=True),
        use_installed_chrome=_as_bool(d, "use_installed_chrome"),
        headless=_as_bool(d, "headless"),
        bet_done_path=_as_str(d, "bet_done_path", required=True),
        log_path=_as_str(d, "log_path", required=True),
        shot_dir=_as_str(d, "shot_dir", required=True),
        stop_file=_as_str(d, "stop_file", required=True),
    )
    if cfg.bet_yen % 100:
        raise ConfigError(f"bet_yen は100円単位にしてください（いまは {cfg.bet_yen}）")
    if cfg.max_yen_per_day is not None and cfg.max_yen_per_day < cfg.bet_yen:
        raise ConfigError(
            f"max_yen_per_day ({cfg.max_yen_per_day}) が bet_yen ({cfg.bet_yen}) より "
            "小さいので、1点も買えません"
        )
    if cfg.close_min_minutes >= cfg.decide_left_minutes:
        raise ConfigError(
            f"close_min_minutes ({cfg.close_min_minutes}) は "
            f"decide_left_minutes ({cfg.decide_left_minutes}) より小さくしてください"
        )
    for k in d:
        if not k.startswith("_") and any(w in k.lower() for w in ("password", "passwd", "pin", "account", "login_id")):
            raise ConfigError(f"config.json に {k} があります。ログイン情報はどこにも書かないでください。消してから動かしてください")
    known = set(DEFAULTS)
    cfg.unknown_keys = sorted(k for k in d if not k.startswith("_") and k not in known)
    return cfg


EXAMPLE = "config.example.json"


def ensure(path):
    """config.json が無ければ、見本（config.example.json）から作る

    ★config.json は git で配らない（人それぞれの設定・約定を読んだ記録が入る）。
      PC の runner.js が10分おきに GitHub を取り込むので、追跡させると取り込みが止まる。
    返すのは (パス, 人に伝えること)。
    """
    path = os.path.abspath(path)
    if os.path.exists(path):
        return path, ""
    sample = os.path.join(os.path.dirname(path), EXAMPLE)
    if not os.path.exists(sample):
        return path, ""
    shutil.copyfile(sample, path)
    return path, (f"{EXAMPLE} から {os.path.basename(path)} を作りました。"
                  "金額などは run.bat の「設定」から直せます")


def load(path):
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise ConfigError(f"設定ファイルがありません: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigError(f"config.json を読めません（JSON が壊れています）: {e}")
    return from_dict(d, base_dir=os.path.dirname(path))
