#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""update.py（run.bat を開くたびに GitHub から取り込む・2026-11-29〜・hikitsugi §4-74）の確かめ

手元に「GitHub の代わり」の git を作って試す（ネットは使わない）。git が無い PC では飛ばす。
"""
import datetime
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update   # noqa: E402

GIT = update.find_git()
JST = datetime.timezone(datetime.timedelta(hours=9))
EARLY = datetime.datetime(2026, 11, 29, 7, 0, tzinfo=JST)       # タスクの知らせが出ない時刻


def g(cwd, *args):
    p = subprocess.run([GIT, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", *args],
                       cwd=cwd, capture_output=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(" ".join(args) + ": " + p.stdout + p.stderr)
    return p.stdout.strip()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


@unittest.skipUnless(GIT, "git が無い")
class TestUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.origin = os.path.join(self.tmp, "origin.git")
        self.dev = os.path.join(self.tmp, "dev")                   # GitHub に送る側
        self.repo = os.path.join(self.tmp, "pc", "keirin")         # PC（C:\keirin\keirin の代わり）
        g(self.tmp, "init", "-q", "--bare", self.origin)
        g(self.tmp, "clone", "-q", self.origin, self.dev)
        g(self.dev, "checkout", "-q", "-b", "main")
        write(os.path.join(self.dev, "bet", "a.py"), "v1\n")
        write(os.path.join(self.dev, "races.json"), "{}\n")
        self.commit("はじめ (#1)")
        os.makedirs(os.path.dirname(self.repo))
        g(self.tmp, "clone", "-q", "-b", "main", self.origin, self.repo)
        self.said = []

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def commit(self, msg):
        g(self.dev, "add", "-A")
        g(self.dev, "commit", "-q", "-m", msg)
        g(self.dev, "push", "-q", "origin", "HEAD:refs/heads/main")

    def run_update(self, answers=()):
        it = iter(answers)
        return update.update(self.repo, ask=lambda *_a: next(it), say=self.said.append, exe=GIT, now=EARLY)

    def text(self):
        return "\n".join(self.said)

    def version_txt(self):
        return read(os.path.join(self.repo, "bet", "logs", "version.txt")).strip()

    def test_最新なら止めずにメニューへ(self):
        self.assertEqual(self.run_update(), 0)
        self.assertIn("最新です", self.text())
        self.assertEqual(self.version_txt(), update.version(GIT, self.repo))
        self.assertRegex(self.version_txt(), r"^[0-9a-f]{7,} \d\d/\d\d \d\d:\d\d$")

    def test_新しいコミットを取り込んで変更の題名を見せる(self):
        old = update.version(GIT, self.repo)
        write(os.path.join(self.dev, "bet", "a.py"), "v2\n")
        self.commit("🔥9車で◎が番手なら見送る (hikitsugi §4-68) (#154)")
        write(os.path.join(self.dev, "races.json"), '{"n": 1}\n')
        self.commit("results update")                                # データだけのコミットは見せない
        self.assertEqual(self.run_update(), 1)
        self.assertEqual(read(os.path.join(self.repo, "bet", "a.py")), "v2\n")
        t = self.text()
        self.assertIn("最新にしました", t)
        self.assertIn("(#154)", t)
        self.assertNotIn("results update", t)
        self.assertNotEqual(self.version_txt(), old)
        self.assertEqual(self.version_txt(), update.version(GIT, self.repo))
        self.said.clear()
        self.assertEqual(self.run_update(), 0)                        # 2回目は最新

    def test_FETCH_HEADは書き換えない(self):
        head = os.path.join(self.repo, ".git", "FETCH_HEAD")
        write(head, "keep\n")                                         # タスクや betplan.js が使っているかもしれない
        self.commit_change()
        self.run_update()
        self.assertEqual(read(head), "keep\n")

    def commit_change(self):
        write(os.path.join(self.dev, "bet", "a.py"), "v2\n")
        self.commit("変更 (#2)")

    def test_racesjsonの手元の差分は捨てて取り込む(self):
        write(os.path.join(self.repo, "races.json"), '{"local": true}\n')
        g(self.repo, "add", "races.json")                             # タスクが「races.json だけ新しくした」形
        self.commit_change()
        self.assertEqual(self.run_update(), 1)                        # 聞かずに取り込む(answers が空なので、聞けば落ちる)
        self.assertEqual(read(os.path.join(self.repo, "bet", "a.py")), "v2\n")
        self.assertEqual(g(self.repo, "status", "--porcelain", "--untracked-files=no"), "")

    def test_手で変えたファイルがあれば聞いてEnterならそのまま(self):
        write(os.path.join(self.repo, "bet", "a.py"), "手で直した\n")
        self.commit_change()
        before = g(self.repo, "rev-parse", "HEAD")
        self.assertEqual(self.run_update([""]), 1)
        self.assertEqual(g(self.repo, "rev-parse", "HEAD"), before)
        self.assertEqual(read(os.path.join(self.repo, "bet", "a.py")), "手で直した\n")
        self.assertIn("bet/a.py", self.text())
        self.assertIn("古いまま", self.text())
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "pc", "backup")))

    def test_手で変えたファイルはyなら写してから最新に(self):
        write(os.path.join(self.repo, "bet", "a.py"), "手で直した\n")
        self.commit_change()
        self.assertEqual(self.run_update(["y"]), 1)
        self.assertEqual(read(os.path.join(self.repo, "bet", "a.py")), "v2\n")
        bk = os.path.join(self.tmp, "pc", "backup")
        saved = [os.path.join(r, f) for r, _, fs in os.walk(bk) for f in fs]
        self.assertEqual(len(saved), 1)
        self.assertTrue(saved[0].replace("\\", "/").endswith("bet/a.py"))
        self.assertEqual(read(saved[0]), "手で直した\n")
        self.assertIn("最新にしました", self.text())

    def test_足しかけのファイルもyなら外して最新に(self):
        write(os.path.join(self.repo, "bet", "new.py"), "足しかけ\n")
        g(self.repo, "add", "bet/new.py")
        self.commit_change()
        self.assertEqual(self.run_update(["y"]), 1)
        self.assertEqual(read(os.path.join(self.repo, "bet", "a.py")), "v2\n")
        self.assertEqual(read(os.path.join(self.repo, "bet", "new.py")), "足しかけ\n")   # ファイルは消さない

    def test_PCで作ったコミットがあると取り込まない(self):
        write(os.path.join(self.repo, "bet", "b.py"), "pc\n")
        g(self.repo, "add", "-A")
        g(self.repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "pc")
        self.commit_change()
        before = g(self.repo, "rev-parse", "HEAD")
        self.assertEqual(self.run_update(), 1)
        self.assertEqual(g(self.repo, "rev-parse", "HEAD"), before)
        self.assertIn("この PC で作った変更", self.text())

    def test_GitHubに届かなくても止めずに動かす(self):
        g(self.repo, "remote", "set-url", "origin", os.path.join(self.tmp, "nai.git"))
        self.assertEqual(self.run_update(), 1)
        self.assertIn("取り込めませんでした", self.text())
        self.assertEqual(self.version_txt(), update.version(GIT, self.repo))

    def test_gitで入れたフォルダでなければ取り込まない(self):
        plain = os.path.join(self.tmp, "plain")
        os.makedirs(plain)
        self.assertEqual(update.update(plain, ask=lambda *_a: "", say=self.said.append, exe=GIT, now=EARLY), 1)
        self.assertIn("git で入れたフォルダではない", self.text())


class TestTaskNote(unittest.TestCase):
    """タスク keirin_snap が止まっていそうなら知らせる(snapwork/runner.json が毎分書き換わる)"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.st = os.path.join(self.tmp, "snapwork", "runner.json")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def at(self, minutes_ago, now):
        write(self.st, "{}")
        t = now.timestamp() - minutes_ago * 60
        os.utime(self.st, (t, t))

    def test_止まっていれば知らせる(self):
        now = datetime.datetime(2026, 11, 28, 20, 0, tzinfo=JST)
        self.at(6 * 24 * 60, now)
        n = update.task_note(self.tmp, now)
        self.assertIn("11/22 20:00", n)
        self.assertIn("install.ps1", n)

    def test_動いていれば知らせない(self):
        now = datetime.datetime(2026, 11, 28, 20, 0, tzinfo=JST)
        self.at(2, now)
        self.assertIsNone(update.task_note(self.tmp, now))

    def test_タスクの時間外と使っていないPCは知らせない(self):
        self.assertIsNone(update.task_note(self.tmp, datetime.datetime(2026, 11, 28, 20, 0, tzinfo=JST)))   # runner.json が無い
        early = datetime.datetime(2026, 11, 29, 8, 5, tzinfo=JST)                                         # 07:50 の始まり直後
        self.at(8 * 60, early)
        self.assertIsNone(update.task_note(self.tmp, early))
        self.assertIsNotNone(update.task_note(self.tmp, early + datetime.timedelta(minutes=10)))


if __name__ == "__main__":
    unittest.main()
