#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本体の1周ぶんの流れ。画面操作は偽物を差し込んで、ロジックだけ回す"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import betlog                        # noqa: E402
import config as config_mod          # noqa: E402
import keirin_bet                    # noqa: E402
import oddspark_page as op           # noqa: E402
from bet_store import BetStore       # noqa: E402
from tests.test_parts import NOW, plan, race   # noqa: E402


class FakeSite:
    """偽の画面。呼ばれた回数と、押したかどうかを覚える"""

    def __init__(self, error=None, site_close="15:05", after_press=None):
        self.calls, self.pressed, self.cleaned = [], [], 0
        self.error, self.site_close, self.after_press = error, site_close, after_press
        self.store_seen = None

    def bet(self, b, live, guard, before_press):
        self.calls.append((b.key, live))
        guard(self.site_close)
        if self.error:
            raise self.error
        if not live:
            return "確認画面まで（押していません）"
        guard(self.site_close)
        before_press()
        self.pressed.append(b.key)
        if self.after_press:
            raise self.after_press
        return "購入済み"

    def cleanup(self):
        self.cleaned += 1
        return True


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.write_config()
        self.store = BetStore(os.path.join(self.dir, "bet_done.json"))

    def write_config(self, **over):
        d = {"i_have_read_the_terms": True, "poll_seconds": 10}
        d.update(over)
        p = os.path.join(self.dir, "config.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        self.cfg = config_mod.load(p)

    def runner(self, mode, p, site=None, now=NOW):
        self.log = betlog.Log(self.cfg.path("log_path"), mode, echo=False)
        site = site or FakeSite()
        self.site = site
        return keirin_bet.Runner(self.cfg, self.store, mode, self.log, lambda: (p, ""),
                                 bet_fn=site.bet, cleanup_fn=site.cleanup, now_fn=lambda: now)

    def logtext(self):
        with open(self.cfg.path("log_path"), encoding="utf-8") as f:
            return f.read()


class TestCycle(Base):
    def test_checkは画面も記録も触らない(self):
        r = self.runner("check", plan(race()))
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual((self.site.calls, self.store.keys()), ([], set()))
        self.assertIn("買い", self.logtext())

    def test_dryは押さず記録もせず片付ける(self):
        r = self.runner("dry", plan(race()))
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(self.site.calls, [("20260926_岐阜_3R", False)])
        self.assertEqual((self.site.pressed, self.store.keys(), self.site.cleaned), ([], set(), 1))
        r.cycle()
        self.assertEqual(len(self.site.calls), 1)           # 同じレースを何周も試さない

    def test_liveは押す直前に記録し二度と買わない(self):
        r = self.runner("live", plan(race()))
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(self.site.pressed, ["20260926_岐阜_3R"])
        rec = self.store.bets["20260926_岐阜_3R"]
        self.assertEqual((rec["yen"], rec["ticket"], rec["note"]), (100, "2=4=9", "購入済み"))
        r.cycle()
        r2 = self.runner("live", plan(race()))              # 動かし直しても
        r2.cycle()
        self.assertEqual(self.site.calls, [])
        self.assertEqual(self.store.spent_on("20260926"), 100)

    def test_押した後で転んだら記録を残して止める(self):
        r = self.runner("live", plan(race()), FakeSite(after_press=op.BetUncertain("画面が読めない")))
        self.assertEqual(r.cycle(), "halt")
        self.assertIn("要確認", self.store.bets["20260926_岐阜_3R"]["note"])
        self.assertEqual(self.store.spent_on("20260926"), 100)

    def test_押す前に転んだら記録せず片付けて打ち切り_2回で見送り(self):
        site = FakeSite(error=RuntimeError("画面が想定と違う"))
        r = self.runner("live", plan(race()), site)
        self.assertEqual(r.cycle(), "abort")
        self.assertEqual((self.store.keys(), site.cleaned), (set(), 1))
        self.assertEqual(r.cycle(), "abort")
        self.assertEqual(self.store.bets["20260926_岐阜_3R"]["yen"], 0)     # 見送りと決めた
        r.cycle()
        self.assertEqual(len(site.calls), 2)

    def test_確認画面が合わなければ押さない(self):
        site = FakeSite(error=op.ConfirmMismatch("組が複数"))
        r = self.runner("live", plan(race()), site)
        self.assertEqual(r.cycle(), "abort")
        self.assertEqual(site.pressed, [])

    def test_場が無ければ見送りと決めて次へ(self):
        site = FakeSite(error=op.SkipRace("場が見当たらない"))
        r = self.runner("live", plan(race()), site)
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(self.store.bets["20260926_岐阜_3R"]["yen"], 0)
        self.assertIn("場が見当たらない", self.store.bets["20260926_岐阜_3R"]["note"])

    def test_サイトの締切が早くて間に合わなければ買わない(self):
        site = FakeSite(site_close="15:01")          # 予定は15:05、画面は15:01（あと1分）
        r = self.runner("live", plan(race()), site)
        self.assertEqual(r.cycle(), "ok")
        self.assertEqual(site.pressed, [])
        self.assertEqual(self.store.bets["20260926_岐阜_3R"]["yen"], 0)

    def test_サイトの締切が読めなければliveは買わない_dryは進む(self):
        r = self.runner("live", plan(race()), FakeSite(site_close=None))
        r.cycle()
        self.assertEqual(self.site.pressed, [])
        self.write_config(require_site_close=False)
        self.store = BetStore(os.path.join(self.dir, "other.json"))
        r = self.runner("live", plan(race()), FakeSite(site_close=None))
        r.cycle()
        self.assertEqual(self.site.pressed, ["20260926_岐阜_3R"])
        r = self.runner("dry", plan(race()), FakeSite(site_close=None))
        self.store = BetStore(os.path.join(self.dir, "dry.json"))
        r.store = self.store
        r.cfg = config_mod.from_dict({"require_site_close": True}, base_dir=self.dir)
        r.cycle()
        self.assertEqual(len(self.site.calls), 1)

    def test_見送りはliveでは記録して決め直さない(self):
        r = self.runner("live", plan(race(verdict="skipEv", ev=0.9)))
        r.cycle()
        self.assertEqual(self.store.bets["20260926_岐阜_3R"]["yen"], 0)
        r2 = self.runner("live", plan(race(verdict="buy", ev=1.3)))   # あとで倍率が動いて「買い」になっても
        r2.cycle()
        self.assertEqual(self.site.calls, [])

    def test_記録できなければ押さずに止める(self):
        class Broken(BetStore):
            def record(self, *a, **k):
                raise OSError("ディスクがいっぱい")
        self.store = Broken(os.path.join(self.dir, "x.json"))
        r = self.runner("live", plan(race()))
        self.assertEqual(r.cycle(), "halt")
        self.assertEqual(self.site.pressed, [])

    def test_ログインが切れたら入り直して_だめなら止める(self):
        site = FakeSite(error=op.LoggedOut("ログインが切れています"))
        r = self.runner("dry", plan(race()), site)
        r.mode = "live"
        relogins = []
        r.keepalive_fn = lambda: relogins.append(1) or True
        self.assertEqual(r.cycle(), "abort")              # 入り直せた → 次の周でもう一度
        self.assertEqual((relogins, self.store.keys()), ([1], set()))
        self.assertEqual(r.cycle(), "halt")               # 2回続いたら止める
        r2 = self.runner("live", plan(race()), FakeSite(error=op.LoggedOut("x")))
        r2.keepalive_fn = lambda: False
        self.assertEqual(r2.cycle(), "halt")
        self.assertEqual(self.store.keys(), set())

    def test_STOPで止まる(self):
        open(self.cfg.path("stop_file"), "w").close()
        r = self.runner("live", plan(race()))
        self.assertEqual(r.cycle(), "stop")
        self.assertEqual(self.site.calls, [])

    def test_判定が取れなくても落ちない(self):
        r = keirin_bet.Runner(self.cfg, self.store, "live", betlog.Log(self.cfg.path("log_path"), "live", echo=False),
                              lambda: (None, "betplan.js が失敗"), now_fn=lambda: NOW)
        self.assertEqual(r.cycle(), "ok")


class TestMain(Base):
    def test_規約を読んだ記録が無ければliveは起動しない(self):
        self.write_config(i_have_read_the_terms=False)
        self.assertEqual(keirin_bet.main(["--mode", "live", "--config", os.path.join(self.dir, "config.json")]), 2)

    def test_fakeはliveで使えない(self):
        self.assertEqual(keirin_bet.main(["--mode", "live", "--fake", "広島-1", "--config", os.path.join(self.dir, "config.json")]), 2)

    def test_fakeの形(self):
        p = keirin_bet.fake_plan("広島-3-6-4-3", NOW)
        self.assertEqual((p["races"][0]["ticket"], p["races"][0]["rno"]), ("3=4=6", 3))
        with self.assertRaises(ValueError):
            keirin_bet.fake_plan("広島", NOW)

    def test_check_fakeを1周(self):
        rc = keirin_bet.main(["--mode", "check", "--once", "--fake", "広島-3-3-4-6", "--config", os.path.join(self.dir, "config.json")])
        self.assertEqual(rc, 0)
        self.assertIn("広島3R", self.logtext())


if __name__ == "__main__":
    unittest.main()
