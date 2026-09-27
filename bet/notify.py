#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""notify.py -- ntfy（https://ntfy.sh）にスマホ通知を送る

  送るのは: 購入した / 購入に失敗した / 買うつもりのレースを買えずに見送った / 自動購入が止まった
  （期待値1未満などの普通の見送りは送らない。1日に何十件も来てしまうので）

★トピック名を知っている人は誰でも通知を読める（ntfy.sh の仕組み）。推測されにくい長い名前にすること。
  通知に入れるのは 場・R・買い目・金額・理由だけ。残高・ログイン情報は入れない。
★送れなくても購入の処理は止めない。送る処理は別スレッドで、終わるとき flush() で最大数秒だけ待つ。
"""
import json
import threading
import urllib.request

TIMEOUT = 8          # 1通あたり何秒まで待つか


def post(server, topic, title, message, priority=3, tags=None, timeout=TIMEOUT):
    """1通送る。送れなければ例外。JSON で送るので日本語のタイトルもそのまま使える"""
    body = json.dumps({
        "topic": topic, "title": title, "message": message,
        "priority": int(priority), "tags": list(tags or []),
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(server.rstrip("/") + "/", data=body, method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        res.read()


class Notifier:
    """config の ntfy_topic が空なら何もしない。send_fn はテストで差し替える"""

    def __init__(self, cfg, mode, log=None, send_fn=None):
        self.server = cfg.ntfy_server
        self.topic = cfg.ntfy_topic
        self.in_dry = cfg.ntfy_in_dry
        self.mode = mode
        self.log = log
        self.send_fn = send_fn or post
        self._threads = []

    @property
    def enabled(self):
        if not self.topic:
            return False
        return self.mode == "live" or (self.mode == "dry" and self.in_dry)

    def send(self, title, message, priority=3, tags=None):
        if not self.enabled:
            return
        if self.mode != "live":
            title = f"（{self.mode}）{title}"

        def go():
            try:
                self.send_fn(self.server, self.topic, title, message, priority, tags)
            except Exception as e:
                if self.log:
                    self.log.event("通知できず", f"ntfy に送れません（{type(e).__name__}: {e}）。購入の処理は続けます")

        t = threading.Thread(target=go, daemon=True)
        t.start()
        self._threads = [x for x in self._threads if x.is_alive()] + [t]

    def flush(self, timeout=TIMEOUT):
        """送りかけの通知を待つ（止まる前に。止まった知らせが届かないと困るので）"""
        for t in self._threads:
            t.join(timeout)
        self._threads = []

    # ---- 知らせる中身 ----
    def bought(self, b, spent_today, note=""):
        self.send("購入しました", f"{_race(b)}\n当日計 {spent_today:,}円" + (f"\n{note}" if note else ""),
                  priority=3, tags=["moneybag"])

    def dry_done(self, b, note=""):
        self.send("確認画面まで進みました（押していません）", f"{_race(b)}" + (f"\n{note}" if note else ""),
                  priority=2, tags=["white_check_mark"])

    def failed(self, b, reason):
        self.send("購入に失敗しました", f"{_race(b)}\n{reason}", priority=4, tags=["warning"])

    def gave_up(self, b, reason):
        self.send("買えずに見送りました", f"{_race(b)}\n{reason}", priority=4, tags=["no_entry_sign"])

    def uncertain(self, b, reason):
        self.send("★購入できたか分かりません", f"{_race(b)}\n{reason}\nオッズパークの投票履歴で確かめてください",
                  priority=5, tags=["rotating_light"])

    def halted(self, reason):
        self.send("自動購入が止まりました", reason, priority=5, tags=["stop_sign"])


def _race(b):
    ev = f" 期待値{b.ev:.2f}" if b.ev is not None else ""
    odds = f" {b.odds}倍" if b.odds is not None else ""
    return f"{b.label} 3連複 {b.ticket} {b.yen:,}円（締切{b.close}{ev}{odds}）"


def test(cfg):
    """設定の通りに1通送ってみる（settings.py・--notify-test から）。(ok, 説明) を返す"""
    if not cfg.ntfy_topic:
        return False, "ntfy_topic（通知先のトピック名）が空です。先に設定してください"
    try:
        post(cfg.ntfy_server, cfg.ntfy_topic, "通知のテスト",
             "keirin の自動購入から送りました。これが届いていれば設定は正しいです", priority=3, tags=["bell"])
    except Exception as e:
        return False, f"送れませんでした（{type(e).__name__}: {e}）"
    return True, f"{cfg.ntfy_server.rstrip('/')}/{cfg.ntfy_topic} に送りました。スマホの ntfy アプリに届いたか見てください"
