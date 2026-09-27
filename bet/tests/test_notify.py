#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ntfy の通知。送り先は偽物（手元の小さな HTTP サーバー / 記録するだけの関数）"""
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import notify                              # noqa: E402
import oddspark_page as op                 # noqa: E402
from tests.test_parts import plan, race    # noqa: E402
from tests.test_runner import Base, FakeSite   # noqa: E402


class Sent:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def __call__(self, server, topic, title, message, priority, tags):
        if self.fail:
            raise OSError("つながらない")
        self.calls.append({"server": server, "topic": topic, "title": title, "message": message,
                           "priority": priority, "tags": tags})

    def titles(self):
        return [c["title"] for c in self.calls]


class NotifyBase(Base):
    def make(self, mode, p, site=None, topic="keirin-test-topic-123", in_dry=False, fail=False):
        self.write_config(ntfy_topic=topic, ntfy_in_dry=in_dry)
        r = self.runner(mode, p, site)
        self.sent = Sent(fail)
        r.notifier = notify.Notifier(self.cfg, mode, self.log, send_fn=self.sent)
        return r


class TestWhenToSend(NotifyBase):
    def test_購入したら知らせる(self):
        r = self.make("live", plan(race()))
        self.assertEqual(r.cycle(), "ok")
        r.notifier.flush()
        self.assertEqual(self.sent.titles(), ["購入しました"])
        c = self.sent.calls[0]
        self.assertEqual(c["topic"], "keirin-test-topic-123")
        self.assertIn("3連複", c["message"])
        self.assertIn("当日計", c["message"])

    def test_画面操作の失敗を知らせる(self):
        r = self.make("live", plan(race()), FakeSite(error=RuntimeError("ボタンが無い")))
        self.assertEqual(r.cycle(), "abort")
        r.notifier.flush()
        self.assertEqual(self.sent.titles(), ["購入に失敗しました"])
        self.assertIn("ボタンが無い", self.sent.calls[0]["message"])
        self.assertEqual(r.cycle(), "abort")          # 2回目で見送りになる
        r.notifier.flush()
        self.assertEqual(self.sent.titles()[-1], "買えずに見送りました")

    def test_発売していなくて買えなかったら知らせる(self):
        r = self.make("live", plan(race()), FakeSite(error=op.SkipRace("チェック欄が無い")))
        self.assertEqual(r.cycle(), "ok")
        r.notifier.flush()
        self.assertEqual(self.sent.titles(), ["買えずに見送りました"])

    def test_押した後に分からなくなったら知らせて止まった知らせも送る(self):
        r = self.make("live", plan(race()), FakeSite(after_press=op.BetUncertain("完了画面が出ない")))
        self.assertEqual(r.loop(once=True), 4)
        self.assertEqual(self.sent.titles(), ["★購入できたか分かりません", "自動購入が止まりました"])
        self.assertEqual(self.sent.calls[0]["priority"], 5)

    def test_期待値で見送っただけなら送らない(self):
        r = self.make("live", plan(race(verdict="skipEv", ev=0.8)))
        r.cycle()
        r.notifier.flush()
        self.assertEqual(self.sent.calls, [])

    def test_トピックが空なら送らない(self):
        r = self.make("live", plan(race()), topic="")
        r.cycle()
        r.notifier.flush()
        self.assertEqual(self.sent.calls, [])

    def test_dryは既定では送らない(self):
        r = self.make("dry", plan(race()))
        r.cycle()
        r.notifier.flush()
        self.assertEqual(self.sent.calls, [])

    def test_dryでも送る設定なら確認画面まで進んだことを送る(self):
        r = self.make("dry", plan(race()), in_dry=True)
        r.cycle()
        r.notifier.flush()
        self.assertEqual(self.sent.titles(), ["（dry）確認画面まで進みました（押していません）"])

    def test_checkは送らない(self):
        r = self.make("check", plan(race()), in_dry=True)
        r.cycle()
        r.notifier.flush()
        self.assertEqual(self.sent.calls, [])

    def test_送れなくても購入は続けてログに残す(self):
        r = self.make("live", plan(race()), fail=True)
        self.assertEqual(r.cycle(), "ok")
        r.notifier.flush()
        self.assertEqual(len(self.store.keys()), 1)
        self.assertIn("通知できず", self.logtext())


class Handler(BaseHTTPRequestHandler):
    got = []

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        Handler.got.append((self.path, self.headers.get("Content-Type"), self.rfile.read(n)))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *a):
        pass


class TestPost(unittest.TestCase):
    def test_JSONで日本語のまま送る(self):
        srv = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        Handler.got = []
        notify.post(f"http://127.0.0.1:{srv.server_port}/", "keirin-abc", "購入しました", "広島7R 1=3=4", 4, ["moneybag"])
        path, ctype, body = Handler.got[0]
        self.assertEqual(path, "/")
        self.assertIn("application/json", ctype)
        d = json.loads(body.decode("utf-8"))
        self.assertEqual(d, {"topic": "keirin-abc", "title": "購入しました", "message": "広島7R 1=3=4",
                             "priority": 4, "tags": ["moneybag"]})


if __name__ == "__main__":
    unittest.main()
