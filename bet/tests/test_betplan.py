#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""betplan.js（Node）の判定を、作った出走表と倍率で確かめる。Node が無ければ飛ばす"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

KEIRIN = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(KEIRIN, "betplan.js")
NODE = shutil.which("node")


def combos(n):
    return [(a, b, c) for a in range(1, n + 1) for b in range(a + 1, n + 1) for c in range(b + 1, n + 1)]


def riders(n):
    # [車番, 年齢, 期, ライン内位置, 評価順位, 評価点, 競走得点, 府県, 3連対率, 着度数の合計, 得点の変化]
    return [[c, 30 + c, 100 + c, 0, c, 60 - c, 90 - c, "岐阜" if c % 2 else "愛知", 40 + c, 20, None] for c in range(1, n + 1)]


def race(key="岐阜_3R", start="15:10", cars=9, ticket="1=2=3", need=False, hot=True):
    place, rno = key.split("_")
    return {"key": key, "place": place, "raceNo": rno, "startTime": start, "date": "2026年09月26日",
            "lines": [[1, 2, 3], [4, 5, 6], [7, 8, 9]][: (cars + 2) // 3] if cars == 9 else [[1, 2, 3], [4, 5], [6, 7]],
            "riders": riders(cars),
            "plan": {"hot": hot, "cars": cars, "ticket": ticket, "needOdds": need,
                     "bandLo": 4 if need else None, "bandHi": 15 if need else None}}


@unittest.skipIf(NODE is None, "node が無い")
class TestBetplan(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)

    def run_plan(self, races, snaps, live=None, now="2026-09-26T15:01:00+09:00"):
        rf = os.path.join(self.dir, "races.json")
        with open(rf, "w", encoding="utf-8") as f:
            json.dump({"races": races}, f, ensure_ascii=False)
        sf = os.path.join(self.dir, "snaps.jsonl")
        with open(sf, "w", encoding="utf-8") as f:
            for s in snaps:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
        args = [NODE, SCRIPT, "--now=" + now, "--races=" + rf, "--snaps=" + sf, "--no-remote"]
        if live is not None:
            lf = os.path.join(self.dir, "live.json")
            with open(lf, "w", encoding="utf-8") as f:
                json.dump(live, f, ensure_ascii=False)
            args.append("--live=" + lf)
        p = subprocess.run(args, capture_output=True, encoding="utf-8", cwd=KEIRIN)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)

    def ev_by_node(self, r, o):
        code = ("const EV=require('./ev.js');const r=%s;const d=EV.deltaFromRiders(r.riders,r.lines,r.place);"
                "console.log(JSON.stringify(EV.evOf(d,r.plan.ticket,%s,r.plan.cars)))") % (json.dumps(r, ensure_ascii=False), json.dumps(o))
        return json.loads(subprocess.run([NODE, "-e", code], capture_output=True, encoding="utf-8", cwd=KEIRIN).stdout)

    def odds(self, n, mine, ticket=(1, 2, 3), base=30.0):
        return [mine if c == ticket else base + i % 50 for i, c in enumerate(combos(n))]

    def test_期待値はev_jsと同じで_1以上なら買い(self):
        r = race()
        o = self.odds(9, 4.0, base=300.0)
        out = self.run_plan([r], [{"t": "15:00:10.000", "k": "岐阜_3R", "left": 4.8, "n": 9, "o": o}])
        x = out["races"][0]
        self.assertEqual((x["close"], x["rno"], x["ticket"]), ("15:05", 3, "1=2=3"))
        self.assertAlmostEqual(x["ev"], self.ev_by_node(r, o), places=3)
        self.assertEqual(x["verdict"], "buy" if x["ev"] >= 1 else "skipEv")
        self.assertAlmostEqual(x["snap"]["age"], 0.8, places=1)
        self.assertEqual(x["snap"]["left"], 4.8)

    def test_期待値1未満(self):
        o = self.odds(9, 40.0, base=5.0)
        x = self.run_plan([race()], [{"t": "15:00:10", "k": "岐阜_3R", "left": 4.8, "n": 9, "o": o}])["races"][0]
        self.assertEqual(x["verdict"], "skipEv")
        self.assertLess(x["ev"], 1)

    def test_7車は帯の外なら見送り(self):
        r = race(cars=7, need=True)
        x = self.run_plan([r], [{"t": "15:00:10", "k": "岐阜_3R", "left": 4.8, "n": 7, "o": self.odds(7, 16.0, base=200.0)}])["races"][0]
        self.assertEqual((x["verdict"], x["odds"]), ("skipBand", 16.0))
        x = self.run_plan([r], [{"t": "15:00:10", "k": "岐阜_3R", "left": 4.8, "n": 7, "o": self.odds(7, 5.0, base=200.0)}])["races"][0]
        self.assertIn(x["verdict"], ("buy", "skipEv"))

    def test_票が薄い_倍率なし_本命でないレース(self):
        o = [9999.9] * 84
        o[0] = 3.0
        out = self.run_plan([race(), race("広島_1R", "15:20", ticket="1=2=4"), race("別府_2R", hot=False)],
                            [{"t": "15:00:10", "k": "岐阜_3R", "left": 4.8, "n": 9, "o": o}])
        v = {x["key"]: x["verdict"] for x in out["races"]}
        self.assertEqual(v, {"岐阜_3R": "thin", "広島_1R": "noOdds"})

    def test_新しいほうの倍率を使う(self):
        local = {"t": "14:57:00", "k": "岐阜_3R", "left": 8.0, "n": 9, "o": self.odds(9, 4.0)}
        live = {"date": "20260926", "source": "GitHub", "races": {"岐阜_3R": {"t": "15:00:30", "left": 4.5, "n": 9, "o": self.odds(9, 6.0)}}}
        x = self.run_plan([race()], [local], live=live)["races"][0]
        self.assertEqual((x["snap"]["src"], x["odds"]), ("odds-live", 6.0))

    def test_ほかの日の出走表は使わない(self):
        r = race()
        r["date"] = "2026年09月25日"
        self.assertEqual(self.run_plan([r], [])["races"], [])


if __name__ == "__main__":
    unittest.main()
