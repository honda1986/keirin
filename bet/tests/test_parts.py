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
    # 選び方のテストは「締切5分前(15:05)の時点で決める」形で書いてあるので、既定の2.5分ではなく6分にする。
    # 決める時刻そのもののテストは decide_at_minutes=2.5 を渡す
    d = {"decide_at_minutes": 6}
    d.update(over)
    return config_mod.from_dict(d, base_dir=tempfile.gettempdir())


def race(close="15:05", verdict="buy", left=4.5, age=0.5, ev=1.2, odds=9.0, need=False, cars=9,
         place="岐阜", rno=3, ticket="2=4=9", snap=True, kind="hot", same=False, bandlo=4, bandhi=15, tickets=None):
    x = {"kind": kind, "key": f"{place}_{rno}R", "date": DATE, "place": place, "rno": rno, "raceNo": f"{rno}R",
            "close": close, "cars": cars, "ticket": ticket, "needOdds": need, "bandLo": bandlo if need else None,
            "bandHi": bandhi if need else None, "verdict": verdict, "ev": ev, "odds": odds, "sameAsHot": same,
            "snap": {"t": "14:59:30", "left": left, "age": age, "src": "PC"} if snap else None}
    if tickets is not None:           # モデルDの複数点 [(組, 期待値, 倍率, 🔥と同じ?), ...]
        x["tickets"] = [{"ticket": t, "ev": e, "odds": o, "sameAsHot": sa} for t, e, o, sa in tickets]
        if tickets:
            x["ticket"], x["ev"], x["odds"] = tickets[0][0], tickets[0][1], tickets[0][2]
    return x


def plan(*races):
    return {"date": DATE, "races": list(races)}


class TestSelector(unittest.TestCase):
    def sel(self, p, done=(), spent=0, bought=0, c=None, at=NOW):
        return selector.select(p, set(done), spent, bought, c or cfg(), at)

    def test_決める時刻になったら最新の倍率で買いなら買う(self):
        r = self.sel(plan(race()))
        self.assertEqual([b.key for b in r.bets], ["20260926_岐阜_3R"])
        self.assertEqual(r.bets[0].ticket, "2=4=9")

    def test_締切2半分前までは決めない_見送りに見えても待つ(self):
        c = cfg(decide_at_minutes=2.5)
        for v in ("buy", "skipEv"):
            r = self.sel(plan(race(close="15:05", verdict=v)), c=c)          # あと5分
            self.assertEqual((r.bets, r.skips), ([], []), v)
        # あと2.4分になったら、そのときの最新の倍率(ここでは買い)で決める
        r = self.sel(plan(race(close="15:05", verdict="buy", left=2.6, age=0.2)), c=c, at=NOW.replace(minute=2, second=36))
        self.assertEqual(len(r.bets), 1)
        self.assertIn("締切2.6分前の倍率で判断", r.bets[0].note)

    def test_少し古い倍率は注記付きで使い_古すぎれば見送り(self):
        r = self.sel(plan(race(age=6)))
        self.assertEqual(len(r.bets), 1)
        self.assertIn("少し古い倍率", r.bets[0].note)
        r = self.sel(plan(race(age=9)))
        self.assertEqual(r.bets, [])
        self.assertIn("届かない", r.skips[0][1])

    def test_期待値1未満は見送りと決める(self):
        r = self.sel(plan(race(verdict="skipEv", ev=0.87)), c=cfg(hot9_use_ev=True))
        self.assertEqual(r.bets, [])
        self.assertEqual(len(r.skips), 1)
        self.assertIn("0.87", r.skips[0][1])

    def test_帯の外は見送り(self):
        r = self.sel(plan(race(verdict="skipBand", need=True, cars=7, odds=16.2)), c=cfg(buy_7car_hot=True))
        self.assertIn("帯4〜15倍の外", r.skips[0][1])

    def test_本命ラインの7車は既定では買わない(self):
        r = self.sel(plan(race(need=True, cars=7)))
        self.assertEqual(r.bets, [])
        self.assertIn("7車", r.skips[0][1])

    def test_票が薄い倍率無しは見送り(self):
        for v in ("thin", "noOdds", "noDelta"):
            r = self.sel(plan(race(verdict=v, ev=None)))
            self.assertEqual(r.bets, [], v)
            self.assertEqual(len(r.skips), 1, v)

    def test_締切間際は手元の最後の倍率で決める(self):
        # 締切まで1.8分・倍率は締切8分前のもの（新しいのが届かない）
        r = self.sel(plan(race(close="15:02", left=8.0, age=5.0)), at=NOW.replace(second=10))
        self.assertEqual(len(r.bets), 1)
        self.assertIn("少し古い倍率", r.bets[0].note)

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
        r = self.sel(p, bought=10, c=cfg(max_races_per_day=10))
        self.assertEqual(r.bets, [])
        self.assertTrue(any("10点" in w for w in r.warnings))

    def test_期待値を使わない設定でも帯は見る(self):
        r = self.sel(plan(race(verdict="noOdds", snap=False)), c=cfg(hot9_use_ev=False))
        self.assertEqual(r.bets, [])              # 9車も 5〜15倍の帯を見るので、倍率が無ければ買わない（2026-09-27〜）
        r = self.sel(plan(race(verdict="skipEv", ev=0.8)), c=cfg(hot9_use_ev=False))
        self.assertEqual(len(r.bets), 1)          # 帯の中なら期待値に関わらず
        r = self.sel(plan(race(verdict="skipBand", need=True, bandlo=5, bandhi=15, odds=4.5)), c=cfg(hot9_use_ev=False))
        self.assertEqual(r.bets, [])
        r = self.sel(plan(race(verdict="skipEv", need=True, cars=7)), c=cfg(use_ev_7car=False, buy_7car_hot=True))
        self.assertEqual(len(r.bets), 1)
        r = self.sel(plan(race(verdict="skipBand", need=True, cars=7)), c=cfg(use_ev_7car=False, buy_7car_hot=True))
        self.assertEqual(r.bets, [])

    def test_期待値は7車と9車で別々(self):
        p = plan(race(verdict="skipEv", ev=0.8), race(place="別府", rno=4, verdict="skipEv", ev=0.8, need=True, cars=7, close="15:04"))
        r = self.sel(p, c=cfg(hot9_use_ev=False, use_ev_7car=True, buy_7car_hot=True))
        self.assertEqual([b.place for b in r.bets], ["岐阜"])
        self.assertEqual([b.place for b, _ in r.skips], ["別府"])
        r = self.sel(p, c=cfg(hot9_use_ev=True, use_ev_7car=False, buy_7car_hot=True))
        self.assertEqual([b.place for b in r.bets], ["別府"])
        self.assertEqual([b.place for b, _ in r.skips], ["岐阜"])

    def test_モデルDは本命ラインと別のキーで買う(self):
        p = plan(race(), race(kind="D", ticket="3=5=8", odds=18.0, ev=1.15))
        r = self.sel(p)
        self.assertEqual(sorted(b.key for b in r.bets), [make_key(DATE, "岐阜", 3), make_key(DATE, "岐阜", 3, "D")])
        d = [b for b in r.bets if b.kind == "D"][0]
        self.assertEqual((d.ticket, d.label), ("3=5=8", "岐阜3R(モデルD)"))
        self.assertTrue(d.key.endswith("_D"))

    def test_モデルDで買う組が無ければ黙って決める(self):
        r = self.sel(plan(race(kind="D", verdict="none", ticket=None)))
        self.assertEqual((r.bets, r.skips, r.quiet), ([], [], [make_key(DATE, "岐阜", 3, "D", i) for i in range(1, 5)]))
        r = self.sel(plan(race(kind="D", snap=False, verdict="noOdds", ticket=None)))
        self.assertEqual((r.bets, r.skips), ([], []))

    def test_モデルDが本命ラインと同じ組なら重ねない(self):
        r = self.sel(plan(race(), race(kind="D", ticket="2=4=9", same=True)))
        self.assertEqual([b.kind for b in r.bets], ["hot"])
        self.assertIn("🔥と同じ組", r.skips[0][1])
        # 🔥を買わない（期待値1未満）ならモデルDは買う
        r = self.sel(plan(race(verdict="skipEv", ev=0.9), race(kind="D", ticket="2=4=9", same=True)), c=cfg(hot9_use_ev=True))
        self.assertEqual([b.kind for b in r.bets], ["D"])
        # 前の周で🔥を「見送り」と決めただけ（買っていない）ならモデルDは買う
        r = self.sel(plan(race(kind="D", ticket="2=4=9", same=True)), done=[make_key(DATE, "岐阜", 3)])
        self.assertEqual([b.kind for b in r.bets], ["D"])
        # 前の周で🔥を買っていたら重ねない
        r = selector.select(plan(race(kind="D", ticket="2=4=9", same=True)), {make_key(DATE, "岐阜", 3)}, 0, 0, cfg(), NOW,
                            bought_keys={make_key(DATE, "岐阜", 3)})
        self.assertEqual(r.bets, [])

    def test_モデルDは条件に合う組を全部買う(self):
        T = [("3=5=8", 1.2, 18.0, False), ("1=3=5", 1.08, 6.5, False)]
        r = self.sel(plan(race(kind="D", tickets=T)))
        self.assertEqual([(b.key, b.ticket, b.odds, b.label) for b in r.bets],
                         [(make_key(DATE, "岐阜", 3, "D"), "3=5=8", 18.0, "岐阜3R(モデルD)"),
                          (make_key(DATE, "岐阜", 3, "D", 2), "1=3=5", 6.5, "岐阜3R(モデルD 2点目)")])
        self.assertEqual(r.bets[1].key, "20260926_岐阜_3R_D2")
        # 使わなかった番号(3点目・4点目)は黙って決めておく
        self.assertEqual(r.quiet, [make_key(DATE, "岐阜", 3, "D", 3), make_key(DATE, "岐阜", 3, "D", 4)])

    def test_モデルDは決めた後に組が増えても買わない(self):
        done = {make_key(DATE, "岐阜", 3, "D", i) for i in range(1, 5)}      # 1点で決めた(2〜4点目は黙って決めた)
        r = self.sel(plan(race(kind="D", tickets=[("3=5=8", 1.2, 18.0, False), ("1=3=5", 1.08, 6.5, False)])), done=done)
        self.assertEqual((r.bets, r.quiet), ([], []))

    def test_モデルDの2点目が失敗したら次の周に2点目だけ買い直す(self):
        done = {make_key(DATE, "岐阜", 3, "D"), make_key(DATE, "岐阜", 3, "D", 3), make_key(DATE, "岐阜", 3, "D", 4)}
        r = self.sel(plan(race(kind="D", tickets=[("3=5=8", 1.2, 18.0, False), ("1=3=5", 1.08, 6.5, False)])), done=done)
        self.assertEqual([(b.key, b.ticket) for b in r.bets], [(make_key(DATE, "岐阜", 3, "D", 2), "1=3=5")])

    def test_モデルDの2点目が本命ラインと同じ組なら2点目だけ重ねない(self):
        r = self.sel(plan(race(), race(kind="D", tickets=[("3=5=8", 1.2, 18.0, False), ("2=4=9", 1.06, 9.0, True)])))
        self.assertEqual(sorted(b.key for b in r.bets), [make_key(DATE, "岐阜", 3), make_key(DATE, "岐阜", 3, "D")])
        self.assertEqual([b.key for b, _ in r.skips], [make_key(DATE, "岐阜", 3, "D", 2)])

    def test_モデルDは多くて4点(self):
        T = [(f"1=2={c}", 1.1, 10.0, False) for c in range(3, 9)]
        r = self.sel(plan(race(kind="D", tickets=T)))
        self.assertEqual(len(r.bets), 4)

    def test_モデルDを買わない設定と決める時刻(self):
        r = self.sel(plan(race(kind="D", ticket="3=5=8")), c=cfg(buy_model_d=False))
        self.assertEqual((r.bets, r.skips, r.quiet), ([], [], []))
        r = self.sel(plan(race(kind="D", ticket="3=5=8")), c=cfg(decide_at_minutes=2.5))
        self.assertEqual((r.bets, r.quiet), ([], []))      # 締切5分前なのでまだ決めない

    def test_古い設定use_evを引き継ぐ(self):
        c = cfg(use_ev=False)
        self.assertEqual((c.use_ev_9car, c.use_ev_7car), (False, False))
        c = cfg(use_ev=False, use_ev_7car=True)
        self.assertEqual((c.use_ev_9car, c.use_ev_7car), (False, True))

    def test_9車の期待値は新しい設定だけを見る(self):
        self.assertEqual(cfg(use_ev_9car=True).use_ev_9car, False)      # 古い設定は見ない（既定は絞らない）
        self.assertEqual(cfg(hot9_use_ev=True).use_ev_9car, True)
        self.assertEqual(cfg().unknown_keys, [])

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

    def test_略した場名(self):
        # 実物 2026-09-29: 買い目一覧で いわき平 が「平」になっていて照合で止まった
        slip = [["", "09/29\n平", "3", "3連複フ\n1-4-7", "14.4", "00円"]]
        self.assertEqual(op.check_slip(slip, "組数：1通り", "合計金額：500円", "いわき平", 3, "1=4=7", "5", 500), [])
        self.assertTrue(op.check_slip(slip, "組数：1通り", "合計金額：500円", "平塚", 3, "1=4=7", "5", 500))
        conf = [["2026/9/29", "平", "3", "3連複", "フォーメーション", "1-4-7", "500円"]]
        self.assertEqual(op.check_confirm(conf, self.CONF_TEXT.replace("100円", "500円"), "いわき平", 3, "1=4=7", 500), [])
        self.assertTrue(op.check_confirm(conf, self.CONF_TEXT.replace("100円", "500円"), "平塚", 3, "1=4=7", 500))
        for text, place, ok in [("09/29平", "いわき平", True), ("いわき平", "いわき平", True), ("09/26\n岐 阜", "岐阜", True),
                                ("小田", "小田原", True), ("平", "平塚", False), ("平塚", "いわき平", False),
                                ("09/29", "岐阜", False), ("", "岐阜", False), ("松阪", "松山", False), ("小", "小倉", False)]:
            self.assertEqual(op.place_matches(text, place), ok, (text, place))

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

    def test_消すだけの小窓はOK(self):
        self.assertTrue(op.is_delete_only("レースまとめ投票へ遷移すると、現在の買い目は削除されます。\nよろしいですか？"))
        self.assertTrue(op.is_delete_only("全ての買い目を削除しますか？"))
        self.assertFalse(op.is_delete_only("投票を申込みます。よろしいですか？"))
        self.assertFalse(op.is_delete_only("買い目を削除して購入しますか？"))
        self.assertFalse(op.is_delete_only("締切間近です。よろしいですか？"))

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
        self.assertEqual((c.bet_yen, c.max_yen_per_day, c.max_races_per_day), (100, 2500, 25))

    def test_おかしな値は止める(self):
        for bad in ({"bet_yen": 150}, {"max_yen_per_day": 50}, {"close_min_minutes": 7}, {"hot9_use_ev": "yes"}, {"payment_method": "card"}):
            with self.assertRaises(config_mod.ConfigError, msg=str(bad)):
                cfg(**bad)


if __name__ == "__main__":
    unittest.main()
