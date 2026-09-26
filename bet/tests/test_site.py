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
import time
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import betlog                        # noqa: E402
import config as config_mod          # noqa: E402
import keirin_bet                    # noqa: E402
import oddspark_page as op           # noqa: E402
import record                        # noqa: E402
import selector                      # noqa: E402
from bet_store import BetStore       # noqa: E402
from jst import date_str, now        # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:                  # pragma: no cover
    sync_playwright = None

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake_site")
BOUGHT = []


ROUTES = {       # 実物の URL → 偽物のファイル
    "/keirin/auth/VoteKeirinTop.do": "keirin/vote.html",
    "/keirin/auth/VoteConfirm.do": "keirin/confirm.html",
    "/keirin/auth/VoteConfirmOpcoin.do": "keirin/confirm.html",
    "/keirin/auth/VoteComplete.do": "keirin/done.html",
    "/keirin/auth/VoteCompleteOpcoin.do": "keirin/done.html",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ROUTES:
            body = open(os.path.join(SITE, ROUTES[path]), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

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

    def bet_obj(self, place="岐阜", rno=3, ticket="3=4=7", cars=9, close_in=10):
        at = now()
        p = {"date": date_str(at), "races": [{"date": date_str(at), "place": place, "rno": rno, "ticket": ticket,
             "close": (at + timedelta(minutes=close_in)).strftime("%H:%M"), "cars": cars, "needOdds": cars < 8,
             "verdict": "buy", "ev": 1.2, "odds": 9.0, "snap": {"left": 5, "age": 0.2}}]}
        return selector.select(p, set(), 0, 0, self.cfg, at).bets[0]

    def slip(self):
        return self.session.vote.evaluate("JSON.parse(localStorage.getItem('slip') || '[]')")

    def test_ログイン前後の見分け(self):
        self.assertIs(op.check_logged_in(self.page), False)
        self.login()

    def test_dryは確認画面で止まり片付く(self):
        self.login()
        seen = []
        note = op.bet(self.session, self.bet_obj(), False, seen.append, lambda: self.fail("dry で押そうとした"))
        self.assertIn("確認画面まで", note)
        self.assertEqual(seen, [op.ON_SALE])
        self.assertEqual(BOUGHT, [])
        t0 = time.time()
        self.assertTrue(self.session.clear_slip())
        self.assertEqual(self.slip(), [])
        self.assertLess(time.time() - t0, 15)                 # 小窓で止まって待ち続けない
        self.assertTrue(self.session._visible(self.session.vote, "race_area"))   # まとめ投票に戻っている

    def test_liveで1点だけ買える_OPコイン(self):
        self.login()
        pressed = []
        note = op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: pressed.append(1))
        self.assertIn("購入済み（OPコイン）", note)
        self.assertEqual(pressed, [1])
        self.assertEqual(BOUGHT, [{"pay": "1", "slip": [{"venue": "岐阜", "race": 3, "t": "3-4-7", "units": 1}]}])
        # 続けてもう1レース（「続けて購入する」で場の選択に戻ったところから）
        op.bet(self.session, self.bet_obj(place="別府", rno=5, ticket="2=5=6", cars=7), True, lambda s: None, lambda: None)
        self.assertEqual(BOUGHT[1]["slip"], [{"venue": "別府", "race": 5, "t": "2-5-6", "units": 1}])

    def test_投票資金で買う設定(self):
        self.cfg = config_mod.from_dict({"oddspark_url": self.url, "payment_method": "cash"}, base_dir=self.dir)
        self.session = op.Session(self.ctx, self.page, self.cfg, self.log)
        self.login()
        note = op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: None)
        self.assertIn("投票資金", note)
        self.assertEqual(BOUGHT[0]["pay"], "0")

    def test_前の買い残りは消してから入れる(self):
        self.login()
        vp = self.session.vote_page()
        vp.evaluate("localStorage.setItem('slip', JSON.stringify([{venue:'別府',race:3,t:'1-2-5',units:1}]))")
        op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: None)
        self.assertEqual(BOUGHT[0]["slip"], [{"venue": "岐阜", "race": 3, "t": "3-4-7", "units": 1}])

    def test_買い目一覧が合わなければ押さない(self):
        self.login()
        vp = self.session.vote_page()
        vp.evaluate("localStorage.setItem('bug', 'swap')")
        with self.assertRaises(op.ConfirmMismatch):
            op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: self.fail("押そうとした"))
        self.assertEqual(BOUGHT, [])
        self.assertTrue(self.session.clear_slip())

    def test_売っていない_締め切った_車立てが違うは見送り(self):
        self.login()
        for kw in ({"place": "函館"}, {"place": "熊本"}, {"place": "岐阜", "rno": 1}, {"place": "岸和田", "rno": 5, "cars": 7},
                   {"place": "別府", "rno": 3, "cars": 9, "ticket": "1=2=3"}):
            with self.assertRaises(op.SkipRace, msg=str(kw)):
                op.bet(self.session, self.bet_obj(**kw), True, lambda s: None, lambda: None)
        self.assertEqual(BOUGHT, [])

    def test_本人確認は人が済ませるのを待つ(self):
        self.login()
        self.page.evaluate("localStorage.setItem('needAuth', '1')")
        op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: None)
        self.assertEqual(len(BOUGHT), 1)
        self.assertIn("本人確認", open(self.cfg.path("log_path"), encoding="utf-8").read())

    def test_セットできないときはサイトの小窓の文面を出す(self):
        self.login()
        self.session.vote_page()
        self.session.vote.evaluate("localStorage.setItem('bug', 'swap')")
        # わざと 3連単 だけにする偽物の不具合は無いので、代わりに賭式を外した状態でセットさせる
        orig = self.session._reset_inputs
        def broken(vp):
            orig(vp)
            vp.locator("#sanrenpuku").uncheck()
        self.session._reset_inputs = broken
        with self.assertRaises(op.ConfirmMismatch) as cm:
            op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: self.fail("押そうとした"))
        self.assertIn("入力が足りません", str(cm.exception))
        self.assertEqual(BOUGHT, [])

    def test_窓を閉じられても開き直す(self):
        self.login()
        self.session.vote_page().close()
        op.bet(self.session, self.bet_obj(), True, lambda s: None, lambda: None)
        self.assertEqual(len(BOUGHT), 1)

    def test_本体の1周でliveに記録まで(self):
        self.login()
        store = BetStore(os.path.join(self.dir, "bet_done.json"))
        at = now()
        p = {"date": date_str(at), "races": [{"date": date_str(at), "place": "岐阜", "rno": 3, "ticket": "3=4=7",
             "close": (at + timedelta(minutes=5)).strftime("%H:%M"), "cars": 9, "needOdds": False,
             "verdict": "buy", "ev": 1.2, "odds": 9.0, "snap": {"left": 5, "age": 0.2}}]}
        r = keirin_bet.Runner(self.cfg, store, "live", self.log, lambda: (p, ""),
                              bet_fn=lambda b, live, g, bp: op.bet(self.session, b, live, g, bp),
                              cleanup_fn=self.session.clear_slip)
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(len(BOUGHT), 1)
        key = f"{date_str(at)}_岐阜_3R"
        self.assertIn("購入済み", store.bets[key]["note"])
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(len(BOUGHT), 1)                 # 二度買わない

    def test_記録モードは操作を残し_秘密は残さない(self):
        rec = record.Recorder(os.path.join(self.dir, "rec"))
        self.ctx.expose_binding("__kbRecord", rec.on_record)
        self.ctx.add_init_script(record.PROBE_JS)
        self.ctx.on("page", lambda p: (rec.note("新しい窓"), rec.watch(p)))
        rec.watch(self.page)
        op.open_top(self.page, self.url)
        self.page.fill('input[name="SSO_ACCOUNTID"]', "himitsu-id-9")
        self.page.fill("#password", "himitsu-pass")
        self.page.press("#password", "Tab")
        self.page.wait_for_timeout(300)
        rec.snap(self.page)                                    # ログイン画面は撮らない
        self.page.click("#btn_login")
        self.page.wait_for_timeout(500)
        with self.page.expect_popup() as info:
            self.page.get_by_role("link", name="投票する").nth(2).click()
        vp = info.value
        vp.wait_for_load_state()
        rec.snap_due()
        vp.click("#todayMultiRace")
        vp.fill("#textfield11", "1")
        vp.press("#textfield11", "Tab")
        vp.wait_for_timeout(500)
        for p in (self.page, vp):
            rec.snap(p)
        rec.close()
        txt = open(os.path.join(self.dir, "rec", "steps.txt"), encoding="utf-8").read()
        if os.environ.get("SHOW_REC"):
            print("\n" + txt)
        self.assertIn("押した  <a> 「投票する」", txt)
        self.assertIn("href=/keirin/auth/VoteKeirinTop.do", txt)
        self.assertIn("#todayMultiRace", txt)
        self.assertRegex(txt, r"入れた  <input> #textfield11 .*値=1\n")
        self.assertIn("（伏せた・12文字）", txt)
        self.assertIn("撮りません", txt)
        everything = ""
        for fn in os.listdir(os.path.join(self.dir, "rec")):
            if fn.endswith((".txt", ".jsonl", ".html")):
                everything += open(os.path.join(self.dir, "rec", fn), encoding="utf-8").read()
        self.assertNotIn("himitsu", everything)
        self.assertTrue(any(fn.endswith(".png") for fn in os.listdir(os.path.join(self.dir, "rec"))))


if __name__ == "__main__":
    unittest.main()
