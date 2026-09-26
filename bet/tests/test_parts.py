#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""部品ごとの確かめ（画面もネットも触らない）"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config as config_mod          # noqa: E402
import oddspark_page as op           # noqa: E402
import selector                      # noqa: E402
from bet_store import BetDoneCorrupt, BetStore, make_key   # noqa: E402
from jst import JST, earlier         # noqa: E402

DATE = "20260926"
NOW = datetime(2026, 9, 26, 15, 0, 0, tzinfo=JST)


def cfg(**over):
    return config_mod.from_dict(dict(over), base_dir=tempfile.gettempdir())


def race(close="15:05", verdict="buy", left=4.5, age=0.5, ev=1.2, odds=9.0, need=False, cars=9,
         place="岐阜", rno=3, ticket="2=4=9", snap=True):
    return {"key": f"{place}_{rno}R", "date": DATE, "place": place, "rno": rno, "raceNo": f"{rno}R",
            "close": close, "cars": cars, "ticket": ticket, "needOdds": need, "bandLo": 4 if need else None,
            "bandHi": 15 if need else None, "verdict": verdict, "ev": ev, "odds": odds,
            "snap": {"t": "14:59:30", "left": left, "age": age, "src": "PC"} if snap else None}


def plan(*races):
    return {"date": DATE, "races": list(races)}


class TestSelector(unittest.TestCase):
    def sel(self, p, done=(), spent=0, bought=0, c=None, at=NOW):
        return selector.select(p, set(done), spent, bought, c or cfg(), at)

    def test_締切6分以内の倍率で買いなら買う(self):
        r = self.sel(plan(race()))
        self.assertEqual([b.key for b in r.bets], ["20260926_岐阜_3R"])
        self.assertEqual(r.bets[0].ticket, "2=4=9")

    def test_倍率がまだ締切6分より前のものなら待つ(self):
        r = self.sel(plan(race(left=8.5)))
        self.assertEqual((r.bets, r.skips), ([], []))

    def test_古い倍率では決めない(self):
        r = self.sel(plan(race(age=6)))
        self.assertEqual((r.bets, r.skips), ([], []))

    def test_期待値1未満は見送りと決める(self):
        r = self.sel(plan(race(verdict="skipEv", ev=0.87)))
        self.assertEqual(r.bets, [])
        self.assertEqual(len(r.skips), 1)
        self.assertIn("0.87", r.skips[0][1])

    def test_帯の外は見送り(self):
        r = self.sel(plan(race(verdict="skipBand", need=True, cars=7, odds=16.2)))
        self.assertIn("帯4〜15倍の外", r.skips[0][1])

    def test_7車を買わない設定(self):
        r = self.sel(plan(race(need=True, cars=7)), c=cfg(buy_7car=False))
        self.assertEqual(r.bets, [])
        self.assertIn("7車", r.skips[0][1])

    def test_票が薄い倍率無しは見送り(self):
        for v in ("thin", "noOdds", "noDelta"):
            r = self.sel(plan(race(verdict=v, ev=None)))
            self.assertEqual(r.bets, [], v)
            self.assertEqual(len(r.skips), 1, v)

    def test_締切間際は手元の最後の倍率で決める(self):
        # 締切まで2.5分・倍率は締切8分前のもの（新しいのが届かない）
        r = self.sel(plan(race(close="15:02", left=8.0, age=5.0)), at=NOW.replace(second=10))
        self.assertEqual(len(r.bets), 1)
        self.assertIn("締切8.0分前の倍率で判断", r.bets[0].note)

    def test_締切間際で倍率が無ければ見送り(self):
        r = self.sel(plan(race(close="15:02", snap=False, verdict="noOdds")), at=NOW.replace(second=10))
        self.assertEqual(r.bets, [])
        self.assertIn("届かない", r.skips[0][1])

    def test_締切まで1分半を切ったら間に合わない(self):
        r = self.sel(plan(race(close="15:01")))
        self.assertEqual((r.bets, r.skips), ([], []))
        self.assertEqual(len(r.late), 1)

    def test_記録済みは二度と選ばない(self):
        r = self.sel(plan(race()), done=[make_key(DATE, "岐阜", 3)])
        self.assertEqual((r.bets, r.skips), ([], []))

    def test_1日の上限(self):
        p = plan(race(), race(place="広島", rno=1, close="15:04"))
        r = self.sel(p, spent=900, c=cfg(max_yen_per_day=1000))
        self.assertEqual(len(r.bets), 1)
        self.assertTrue(any("上限 1000円" in w for w in r.warnings))
        r = self.sel(p, bought=10)
        self.assertEqual(r.bets, [])
        self.assertTrue(any("10レース" in w for w in r.warnings))

    def test_期待値を使わない設定の9車は倍率なしでも買う(self):
        r = self.sel(plan(race(verdict="noOdds", snap=False)), c=cfg(use_ev=False))
        self.assertEqual(len(r.bets), 1)
        r = self.sel(plan(race(verdict="skipEv", need=True, cars=7)), c=cfg(use_ev=False))
        self.assertEqual(len(r.bets), 1)          # 7車は帯の中なら期待値に関わらず
        r = self.sel(plan(race(verdict="skipBand", need=True, cars=7)), c=cfg(use_ev=False))
        self.assertEqual(r.bets, [])

    def test_締切の近い順(self):
        r = self.sel(plan(race(close="15:05"), race(place="広島", rno=1, close="15:04")))
        self.assertEqual([b.place for b in r.bets], ["広島", "岐阜"])


class TestConfirm(unittest.TestCase):
    """実物（2026-09-26 に記録モードで採った画面）の文字の形で確かめる"""
    SLIP = [["", "09/26\n岐 阜", "2", "3連複フ\n3-4-7", "9.1", "00円"]]
    CONF = [["2026/9/26", "岐阜", "2", "3連複", "フォーメーション", " 3-4-7 ", "100円 "]]
    CONF_TEXT = "投票申込確認\n開催日\t開催場\n2026/9/26\t岐阜\t2\t3連複\t3-4-7\t100円\n組数\t1通り\n合計金額\t100円\n投票を申込"
    DONE = [["2026/9/26", "岐 阜", "2", "3連複", "フォーメーション", " 3-4-7 ", "100円 ", " ○ "]]

    def test_買い目一覧(self):
        self.assertEqual(op.check_slip(self.SLIP, "組数：1通り", "合計金額：100円", "岐阜", 2, "3=4=7", "1", 100), [])
        self.assertTrue(op.check_slip(self.SLIP, "組数：1通り", "合計金額：100円", "岐阜", 2, "3=4=6", "1", 100))
        self.assertTrue(op.check_slip(self.SLIP, "組数：1通り", "合計金額：100円", "岐阜", 12, "3=4=7", "1", 100))
        self.assertTrue(op.check_slip(self.SLIP, "組数：1通り", "合計金額：100円", "別府", 2, "3=4=7", "1", 100))
        self.assertTrue(op.check_slip(self.SLIP * 2, "組数：2通り", "合計金額：200円", "岐阜", 2, "3=4=7", "1", 100))
        self.assertTrue(op.check_slip(self.SLIP, "組数：11通り", "合計金額：100円", "岐阜", 2, "3=4=7", "1", 100))

    def test_確認画面(self):
        self.assertEqual(op.check_confirm(self.CONF, self.CONF_TEXT, "岐阜", 2, "3=4=7", 100), [])
        self.assertTrue(op.check_confirm(self.CONF, self.CONF_TEXT, "岐阜", 2, "3=4=7", 200))
        self.assertTrue(op.check_confirm(self.CONF, self.CONF_TEXT, "岐阜", 3, "3=4=7", 100))
        self.assertTrue(op.check_confirm(self.CONF * 2, self.CONF_TEXT, "岐阜", 2, "3=4=7", 100))
        bad = [["2026/9/26", "岐阜", "2", "3連単", "フォーメーション", "3-4-7", "100円"]]
        self.assertTrue(op.check_confirm(bad, self.CONF_TEXT, "岐阜", 2, "3=4=7", 100))
        self.assertTrue(any("合計" in x for x in op.check_confirm(self.CONF, "組数 1通り", "岐阜", 2, "3=4=7", 100)))

    def test_完了画面(self):
        t = "投票申込完了\n投票申込を受け付けました。ご利用ありがとうございます。"
        self.assertEqual(op.check_done(self.DONE, t, "岐阜", 2, "3=4=7"), "")
        self.assertIn("受付", op.check_done([self.DONE[0][:7] + ["×"]], t, "岐阜", 2, "3=4=7"))
        self.assertTrue(op.check_done(self.DONE, "エラーが発生しました", "岐阜", 2, "3=4=7"))
        self.assertTrue(op.check_done(self.DONE, t, "岐阜", 3, "3=4=7"))

    def test_断られた画面(self):
        self.assertTrue(op.looks_refused("※投票の前に入金が必要です。"))
        self.assertEqual(op.looks_refused("投票申込確認"), "")

    def test_早いほうの締切(self):
        self.assertEqual(earlier(DATE, "15:23", "15:21"), "15:21")
        self.assertEqual(earlier(DATE, "15:23", None), "15:23")
        self.assertEqual(earlier(DATE, "15:23", op.ON_SALE), "15:23")


class TestStoreAndConfig(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_記録は即書き読み直せる(self):
        p = os.path.join(self.dir, "bet_done.json")
        s = BetStore(p)
        b = selector.select(plan(race()), set(), 0, 0, cfg(), NOW).bets[0]
        s.record(b, "live", 100, note="押す直前")
        self.assertEqual(BetStore(p).spent_on(DATE), 100)
        self.assertEqual(BetStore(p).races_on(DATE), 1)
        with self.assertRaises(RuntimeError):
            s.record(b, "live", 100)

    def test_見送りは金額に数えない(self):
        p = os.path.join(self.dir, "bet_done.json")
        s = BetStore(p)
        b = selector.select(plan(race()), set(), 0, 0, cfg(), NOW).bets[0]
        s.record(b, "live", 0, note="見送り")
        self.assertEqual((s.spent_on(DATE), s.races_on(DATE)), (0, 0))
        self.assertTrue(s.has(b.key))

    def test_壊れていたら起動しない(self):
        p = os.path.join(self.dir, "bet_done.json")
        with open(p, "w") as f:
            f.write("{壊れ")
        with self.assertRaises(BetDoneCorrupt):
            BetStore(p)

    def test_ログイン情報の項目は受け付けない(self):
        for k in ("password", "login_id", "pin_code", "SSO_ACCOUNTID"):
            with self.assertRaises(config_mod.ConfigError, msg=k):
                cfg(**{k: "x"})

    def test_見本がそのまま読める(self):
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(here, "config.example.json"), encoding="utf-8") as f:
            c = config_mod.from_dict(json.load(f))
        self.assertFalse(c.i_have_read_the_terms)
        self.assertEqual((c.bet_yen, c.max_yen_per_day, c.max_races_per_day), (100, 1000, 10))

    def test_おかしな値は止める(self):
        for bad in ({"bet_yen": 150}, {"max_yen_per_day": 50}, {"close_min_minutes": 7}, {"use_ev": "yes"}, {"payment_method": "card"}):
            with self.assertRaises(config_mod.ConfigError, msg=str(bad)):
                cfg(**bad)


if __name__ == "__main__":
    unittest.main()
