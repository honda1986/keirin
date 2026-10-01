#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""browser.py -- 専用プロファイルの Chrome を開く

ログインID・パスワード・暗証番号はどこにも保存しない。
dry / live を動かしたときに開く Chrome で、そのつど手で入れてもらう。

競艇の auto_bet（v24）と同じもの。プロファイルのフォルダが別なら、両方同時に動かせる
（同じプロファイルは2つ同時に開けない）。

profile_dir は .gitignore に入れてある。絶対に共有しないこと。
"""
import contextlib
import json
import os
import re
import subprocess
import time


class BrowserUnavailable(Exception):
    pass


def profile_pids(rows, user_data_dir):
    """rows = [{ProcessId, CommandLine}, ...] のうち、--user-data-dir がこのプロファイルの Chrome の PID"""
    target = os.path.normcase(os.path.abspath(user_data_dir)).rstrip("\\/")
    out = []
    for r in rows or []:
        cl = (r or {}).get("CommandLine") or ""
        m = re.search(r'--user-data-dir=(?:"([^"]+)"|(\S+))', cl)
        if not m:
            continue
        p = os.path.normcase(os.path.abspath(m.group(1) or m.group(2))).rstrip("\\/")
        if p == target:
            try:
                out.append(int(r.get("ProcessId")))
            except (TypeError, ValueError):
                pass
    return out


def _chrome_rows():
    """Chrome の一覧 [{ProcessId, CommandLine}]（Windows は chrome.exe・それ以外は ps）。読めないときは []"""
    if os.name != "nt":
        try:
            r = subprocess.run(["ps", "-eo", "pid=,args="], capture_output=True, timeout=20, encoding="utf-8", errors="replace")
            rows = []
            for line in (r.stdout or "").splitlines():
                pid, _, args = line.strip().partition(" ")
                if "chrom" in args:
                    rows.append({"ProcessId": pid, "CommandLine": args})
            return rows
        except Exception:
            return []
    ps = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                           capture_output=True, timeout=40, encoding="utf-8", errors="replace")
        txt = (r.stdout or "").strip()
        if not txt:
            return []
        d = json.loads(txt)
        return [d] if isinstance(d, dict) else d
    except Exception:
        return []


def _close_leftovers(user_data_dir):
    """このプロファイルで残っている Chrome を閉じる（普段使いの Chrome は --user-data-dir が違うので触らない）。
    閉じた PID の一覧。残っていなければ、前に落ちたときの lockfile を消してみる"""
    pids = profile_pids(_chrome_rows(), user_data_dir)
    for pid in pids:
        with contextlib.suppress(Exception):
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=20)
            else:
                os.kill(pid, 9)
    if not pids:
        with contextlib.suppress(Exception):
            os.remove(os.path.join(user_data_dir, "lockfile"))     # 使っている Chrome がいれば消せない（それでよい）
    return pids


@contextlib.contextmanager
def open_context(cfg):
    """(context, page) を渡す。終わったら必ず閉じる"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise BrowserUnavailable(
            "playwright が入っていません。\n"
            "  pip install playwright\n"
            "  playwright install chromium"
        )

    user_data_dir = cfg.path("profile_dir")
    os.makedirs(user_data_dir, exist_ok=True)
    kwargs = {
        "user_data_dir": user_data_dir,
        "headless": bool(cfg.headless),    # 既定は False。画面が見えるほうが事故に気づける
        "viewport": {"width": 1280, "height": 900},
    }
    if cfg.use_installed_chrome:
        kwargs["channel"] = "chrome"
    elif os.environ.get("KEIRIN_BET_CHROMIUM"):
        kwargs["executable_path"] = os.environ["KEIRIN_BET_CHROMIUM"]   # テスト用（playwright install していない環境）

    with sync_playwright() as p:
        try:
            try:
                context = p.chromium.launch_persistent_context(**kwargs)
            except Exception:
                # よくあるのは、前に開いた Chrome（login モードや、落ちたときの残り）が同じプロファイルで裏に残っていること。
                # 新しい Chrome は残っている方に処理を渡してすぐ終わる（終了コード 0・TargetClosedError）。残りを閉じて1回だけやり直す
                pids = _close_leftovers(user_data_dir)
                print("Chrome を起動できなかったので、" +
                      (f"このプロファイルで残っていた Chrome（PID {', '.join(map(str, pids))}）を閉じて" if pids else "") +
                      "もう一度起動します")
                time.sleep(3)
                context = p.chromium.launch_persistent_context(**kwargs)
        except Exception as e:
            raise BrowserUnavailable(
                f"Chrome を起動できません: {type(e).__name__}: {e}\n"
                "  ・login モードで開いた Chrome が残っていたら、閉じてください\n"
                "    （同じプロファイルは2つ同時に使えません）\n"
                f"  ・使っているプロファイル: {user_data_dir}\n"
                "  ・タスクマネージャーで Google Chrome をすべて終了するか、PC を再起動してからやり直してください\n"
                "  ・ウイルス対策ソフトが止めていないか確認してください\n"
                "  ・Chrome が入っていない場合は config.json の "
                "use_installed_chrome を false にしてください"
            )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            yield context, page
        finally:
            with contextlib.suppress(Exception):
                context.close()
