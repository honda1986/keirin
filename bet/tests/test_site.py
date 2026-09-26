#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""偽のオッズパーク（tests/fake_site）で、画面操作を最後まで通す

★偽物は採取されたセレクタ（#row1_3 / #textfield11 / 「投票する」のポップアップ など）を真似ただけで、
  実物の作りは知らない。ここが通っても、実物では dry で確かめること。
playwright が入っていなければ飛ばす。
"""
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import betlog                        # noqa: E402
import config as config_mod          # noqa: E402
import keirin_bet                    # noqa: E402
import oddspark_page as op           # noqa: E402
import selector                      # noqa: E402
from bet_store import BetStore       # noqa: E402
from jst import date_str, now        # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:                  # pragma: no cover
    sync_playwright = None

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake_site")
BOUGHT = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        BOUGHT.append(json.loads(body.decode("utf-8")))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(str(len(BOUGHT)).encode())

    def log_message(self, *a):
        pass


@unittest.skipIf(sync_playwright is None, "playwright が入っていない")
class TestFakeSite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.httpd.server_address[1]}/index.html"
        cls.pw = sync_playwright().start()
        # KEIRIN_BET_CHROMIUM に chrome の場所を入れれば、それを使う（playwright install していない環境用）
        exe = os.environ.get("KEIRIN_BET_CHROMIUM") or None
        try:
            cls.browser = cls.pw.chromium.launch(headless=True, executable_path=exe)
        except Exception as e:
            cls.pw.stop()
            cls.httpd.shutdown()
            raise unittest.SkipTest(f"Chromium を起動できない（{str(e).splitlines()[0]}）")

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.httpd.shutdown()

    def setUp(self):
        BOUGHT.clear()
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.cfg = config_mod.from_dict({"i_have_read_the_terms": True, "oddspark_url": self.url}, base_dir=self.dir)
        self.ctx = self.browser.new_context()
        self.addCleanup(self.ctx.close)
        self.page = self.ctx.new_page()
        self.log = betlog.Log(self.cfg.path("log_path"), "test", echo=False)
        self.session = op.Session(self.ctx, self.page, self.cfg, self.log)
        op.open_top(self.page, self.url)

    def login(self):
        # テストの偽物なので、手で入れる代わりにボタンを押すだけ（実物では人が手でログインする）
        self.page.click("#btn_login")
        op.open_top(self.page, self.url)
        self.assertIs(op.check_logged_in(self.page), True)

    def bet_obj(self, place="広島", rno=3, ticket="3=4=6", close_in=10):
        at = now()
        p = {"date": date_str(at), "races": [{"date": date_str(at), "place": place, "rno": rno, "ticket": ticket,
             "close": (at + timedelta(minutes=close_in)).strftime("%H:%M"), "cars": 9, "needOdds": False,
             "verdict": "buy", "ev": 1.2, "odds": 9.0, "snap": {"left": 5, "age": 0.2}}]}
        return selector.select(p, set(), 0, 0, self.cfg, at).bets[0]

    def test_ログイン前後の見分け(self):
        self.assertIs(op.check_logged_in(self.page), False)
        self.login()

    def test_dryは確認画面で止まり片付く(self):
        self.login()
        b = self.bet_obj()
        seen = []
        note = op.bet(self.session, b, False, seen.append, lambda: self.fail("dry で押そうとした"))
        self.assertIn("確認画面まで", note)
        self.assertEqual(len(seen), 1)
        self.assertRegex(seen[0], r"^\d\d:\d\d$")                     # 画面の締切が読めた
        self.assertEqual(BOUGHT, [])
        self.assertTrue(self.session.clear_slip())
        self.assertEqual(self.session.vote.evaluate("localStorage.getItem('slip')"), "[]")

    def test_liveで1点だけ買える(self):
        self.login()
        b = self.bet_obj()
        pressed = []
        note = op.bet(self.session, b, True, lambda s: None, lambda: pressed.append(1))
        self.assertIn("購入済み", note)
        self.assertEqual(pressed, [1])
        self.assertEqual(BOUGHT, [[{"venue": "広島", "race": 3, "t": "3-4-6", "yen": 100}]])
        # 続けてもう1レース（同じ窓のまま）
        op.bet(self.session, self.bet_obj(place="岐阜", rno=5, ticket="2=5=9"), True, lambda s: None, lambda: None)
        self.assertEqual(BOUGHT[1], [{"venue": "岐阜", "race": 5, "t": "2-5-9", "yen": 100}])

    def test_買い残りがあれば押さない(self):
        self.login()
        vp = self.session.vote_page()
        vp.evaluate("localStorage.setItem('slip', JSON.stringify([{venue:'広島',race:3,t:'1-2-5',yen:100}]))")
        vp.reload()
        with self.assertRaises(op.ConfirmMismatch):
            op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: self.fail("押そうとした"))
        self.assertEqual(BOUGHT, [])

    def test_売っていない場は見送り(self):
        self.login()
        with self.assertRaises(op.SkipRace):
            op.bet(self.session, self.bet_obj(place="函館"), True, lambda s: None, lambda: None)

    def test_9車の欄が無ければ見送り(self):
        self.login()
        with self.assertRaises(op.SkipRace):           # 偽物の青森は7車
            op.bet(self.session, self.bet_obj(place="青森", ticket="2=5=9"), True, lambda s: None, lambda: None)

    def test_窓を閉じられても開き直す(self):
        self.login()
        self.session.vote_page().close()
        op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: None)
        self.assertEqual(len(BOUGHT), 1)

    def test_本体の1周でliveに記録まで(self):
        self.login()
        store = BetStore(os.path.join(self.dir, "bet_done.json"))
        at = now()
        p = {"date": date_str(at), "races": [{"date": date_str(at), "place": "広島", "rno": 3, "ticket": "3=4=6",
             "close": (at + timedelta(minutes=5)).strftime("%H:%M"), "cars": 9, "needOdds": False,
             "verdict": "buy", "ev": 1.2, "odds": 9.0, "snap": {"left": 5, "age": 0.2}}]}
        r = keirin_bet.Runner(self.cfg, store, "live", self.log, lambda: (p, ""),
                              bet_fn=lambda b, live, g, bp: op.bet(self.session, b, live, g, bp),
                              cleanup_fn=self.session.clear_slip)
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(len(BOUGHT), 1)
        key = f"{date_str(at)}_広島_3R"
        self.assertIn("購入済み", store.bets[key]["note"])
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(len(BOUGHT), 1)                 # 二度買わない


if __name__ == "__main__":
    unittest.main()
