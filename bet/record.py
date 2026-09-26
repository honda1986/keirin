#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""record.py -- オッズパークの画面を手で操作して、その手順を記録する（自動投票の作り直し用）

  python record.py
    → Chrome が開く → 自分でログインして、ためしたい投票画面で1レースぶん操作する
    → 黒い画面で Enter を押すと終わり → records\\日時\\ に記録が残る

記録するもの:
  steps.txt      … 押したところ・入れたところの一覧（人が読む形。これを見せてもらえれば作り直せる）
  steps.jsonl    … 同じものの細かい版（id・name・class・リンク先・onclick・画面の位置など）
  NN_*.png/.html … 画面が変わるたびのスクショと HTML（枠 iframe の中も）

★記録しないもの（安全のため）:
  ・入力欄に入れた文字。ID・パスワード・暗証番号は「（伏せた・N文字）」とだけ残す
    例外は「1〜3桁の数字だけ」で、名前が ID・パス・暗証っぽくない欄（金額や口数）
  ・ログイン画面・暗証番号の画面のスクショと HTML
  ・HTML の中の入力欄の中身・隠し欄・スクリプト
★それでも残るもの: 画面に出ている残高・お名前・会員番号。人に見せる前に steps.txt と画像を確かめてください。

★確認のダイアログ（「よろしいですか？」の小窓）は、このモードでは自動で「キャンセル」になります
  （Playwright の決まり）。出たことと文面は記録に残るので、それで十分です。
  「購入する」まで押したい場合、ダイアログが出る画面では購入できません。
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import browser                      # noqa: E402
import config as config_mod         # noqa: E402
from jst import now                 # noqa: E402
from oddspark_page import SAFE_HTML_JS   # noqa: E402

# 押した・入れたところを拾う。どの画面・どの枠にも差し込む
PROBE_JS = r"""
(() => {
  // ★印は document に付ける。window.open の窓は about:blank → 本来のページへ移るとき window を使い回すので、
  //   window に付けると2回目が「入れ済み」と思って何もせず、新しい document のクリックを拾えなかった（実物で起きた）
  if (document.__kbRecOn) return; document.__kbRecOn = true;
  const SECRET = /pass|pwd|pin|暗証|account|login|user|sso|id$|^id|mail|kanyu|加入|会員/i;
  const short = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  function cssPath(el) {
    const out = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 7; e = e.parentElement, i++) {
      if (e.id) { out.unshift(e.tagName.toLowerCase() + '#' + e.id); break; }
      let k = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) k++;
      out.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + k + ')');
    }
    return out.join(' > ');
  }
  function ancestors(el) {
    const out = [];
    for (let e = el.parentElement, i = 0; e && i < 8; e = e.parentElement, i++) {
      if (e.id || e.className) out.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''));
    }
    return out;
  }
  function describe(el) {
    const img = el.querySelector && el.querySelector('img');
    const r = el.getBoundingClientRect();
    const d = {
      tag: el.tagName.toLowerCase(), id: el.id || '', name: el.getAttribute('name') || '',
      type: el.getAttribute('type') || '', cls: typeof el.className === 'string' ? short(el.className, 80) : '',
      text: short(el.innerText || el.textContent, 60), aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '', alt: el.getAttribute('alt') || (img ? img.getAttribute('alt') || '' : ''),
      src: img ? short(img.getAttribute('src'), 120) : '',
      href: short(el.getAttribute('href'), 160), onclick: short(el.getAttribute('onclick'), 200),
      target: el.getAttribute('target') || '', css: cssPath(el), parents: ancestors(el),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    };
    if (d.tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(d.type.toLowerCase())) d.text = el.value || d.alt;
    return d;
  }
  function target(e) {
    let el = e.target;
    for (let i = 0; el && i < 5; i++, el = el.parentElement) {
      if (/^(a|button|input|select|label|area|option|td|th|li|span|div|img)$/i.test(el.tagName) &&
          (el.onclick || el.getAttribute('onclick') || /^(a|button|input|select|label|area|option)$/i.test(el.tagName))) return el;
    }
    return e.target;
  }
  const send = (o) => { try { window.__kbRecord(Object.assign(o, { url: location.href, frame: window !== window.top })); } catch (x) {} };
  document.addEventListener('click', (e) => { try { send({ ev: 'click', el: describe(target(e)) }); } catch (x) {} }, true);
  document.addEventListener('change', (e) => {
    const el = e.target; if (!el || !el.tagName) return;
    const d = describe(el);
    let v = el.value == null ? '' : String(el.value);
    const secretName = SECRET.test(d.name + ' ' + d.id + ' ' + (el.getAttribute('placeholder') || ''));
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex]; d.value = o ? short(o.text, 40) + ' (value=' + short(o.value, 20) + ')' : '';
    } else if (/^(checkbox|radio)$/i.test(d.type)) {
      d.value = el.checked ? 'チェックあり' : 'チェックなし';
    } else if (/password/i.test(d.type) || secretName || !/^\d{1,3}$/.test(v)) {
      d.value = '（伏せた・' + v.length + '文字）';
    } else {
      d.value = v;
    }
    send({ ev: 'input', el: d });
  }, true);
})();
"""


def is_login_page(page):
    """ログイン画面・暗証番号の画面なら True（撮らない）"""
    try:
        return bool(page.evaluate("""() => {
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          if ([...document.querySelectorAll('input[type=password], input[name=SSO_ACCOUNTID]')].some(vis)) return true;
          const t = document.body ? document.body.innerText : '';
          return /暗証番号/.test(t) && [...document.querySelectorAll('input')].filter(vis).filter((e) => !/button|submit|hidden|image/i.test(e.type)).length <= 2;
        }"""))
    except Exception:
        return False


class Recorder:
    def __init__(self, out_dir):
        self.out = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.n = 0
        self.steps = []
        self.lock = threading.Lock()
        self.dirty = {}            # page → 撮る予定の時刻
        self.page_ids = {}
        self.txt = open(os.path.join(out_dir, "steps.txt"), "w", encoding="utf-8")
        self.jsonl = open(os.path.join(out_dir, "steps.jsonl"), "w", encoding="utf-8")

    def pid(self, page):
        if page not in self.page_ids:
            self.page_ids[page] = len(self.page_ids) + 1
        return self.page_ids[page]

    def note(self, line, data=None):
        with self.lock:
            if self.txt.closed:
                return
            stamp = now().strftime("%H:%M:%S")
            self.txt.write(f"{stamp} {line}\n")
            self.txt.flush()
            if data is not None:
                self.jsonl.write(json.dumps({"t": stamp, **data}, ensure_ascii=False) + "\n")
                self.jsonl.flush()
            print(f"  {stamp} {line}", flush=True)

    def on_record(self, source, obj):
        page = source.get("page") if isinstance(source, dict) else getattr(source, "page", None)
        el = obj.get("el") or {}
        w = f"窓{self.pid(page)}" if page is not None else "窓?"
        where = w + ("・枠の中" if obj.get("frame") else "")
        label = el.get("text") or el.get("alt") or el.get("aria") or el.get("title") or el.get("value") or ""
        ident = " ".join(x for x in (
            f"#{el['id']}" if el.get("id") else "", f"name={el['name']}" if el.get("name") else "",
            f"class={el['cls']}" if el.get("cls") else "") if x)
        if obj.get("ev") == "input":
            self.note(f"[{where}] 入れた  <{el.get('tag')}> {ident} 値={el.get('value')}", obj)
        else:
            extra = ""
            if el.get("href") and not el["href"].startswith("#"):
                extra += f" href={el['href'][:80]}"
            if el.get("onclick"):
                extra += f" onclick={el['onclick'][:80]}"
            self.note(f"[{where}] 押した  <{el.get('tag')}> 「{label[:40]}」 {ident}{extra}  (場所 {el.get('css', '')[:120]})", obj)
        if page is not None:
            self.dirty[page] = time.time() + 1.5    # 押してから画面が落ち着いたころに撮る

    @staticmethod
    def inject(page):
        """記録の仕掛けを全部の枠に入れる（入れ済みなら何もしない）

        ★add_init_script だけでは足りない。ポップアップが about:blank から本来のページへ移る最初の1回は
          init script が走らない（2026-09-26 の実物の記録で「レースまとめ投票」を押したのが残らなかった）
        """
        for fr in list(page.frames):
            try:
                fr.evaluate(PROBE_JS)
            except Exception:
                pass

    def watch(self, page):
        self.pid(page)
        page.on("domcontentloaded", lambda: self.inject(page))
        page.on("framenavigated", lambda fr: fr == page.main_frame and self.dirty.__setitem__(page, time.time() + 1.0))
        page.on("dialog", lambda d: self._dialog(page, d))
        page.on("close", lambda: self.note(f"[窓{self.pid(page)}] 閉じた"))
        self.dirty[page] = time.time() + 1.0

    def _dialog(self, page, d):
        self.note(f"[窓{self.pid(page)}] ★ダイアログ（{d.type}）「{d.message[:120]}」→ 自動でキャンセルしました",
                  {"ev": "dialog", "type": d.type, "message": d.message})
        try:
            d.dismiss()
        except Exception:
            pass

    def snap_due(self):
        for page, at in list(self.dirty.items()):
            if time.time() < at:
                continue
            self.dirty.pop(page, None)
            if page.is_closed():
                continue
            self.inject(page)
            self.snap(page)

    def snap(self, page):
        self.n += 1
        w = self.pid(page)
        try:
            title = page.title()
        except Exception:
            title = ""
        base = os.path.join(self.out, f"{self.n:02d}_窓{w}")
        if is_login_page(page):
            self.note(f"[窓{w}] 画面 {page.url[:100]}（ログイン・暗証番号の画面なので撮りません）", {"ev": "page", "url": page.url, "skipped": True})
            return
        try:
            page.screenshot(path=base + ".png", full_page=True)
        except Exception as e:
            self.note(f"[窓{w}] スクショ取れず: {e}")
        try:
            with open(base + ".html", "w", encoding="utf-8") as f:
                f.write(f"<!-- {page.url} -->\n" + page.main_frame.evaluate(SAFE_HTML_JS))
            for i, fr in enumerate(page.frames[1:], 1):
                with open(f"{base}_枠{i}.html", "w", encoding="utf-8") as f:
                    f.write(f"<!-- {fr.url} -->\n" + fr.evaluate(SAFE_HTML_JS))
        except Exception as e:
            self.note(f"[窓{w}] HTML 取れず: {e}")
        frames = len(page.frames) - 1
        self.note(f"[窓{w}] 画面 {self.n:02d}「{title[:40]}」 {page.url[:120]}" + (f"（枠 {frames}個）" if frames else ""),
                  {"ev": "page", "n": self.n, "url": page.url, "title": title, "frames": [f.url for f in page.frames[1:]]})

    def close(self):
        with self.lock:
            self.txt.close()
            self.jsonl.close()


def main(argv=None):
    ap = argparse.ArgumentParser(description="オッズパークの画面操作を記録する")
    ap.add_argument("--config", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"))
    ap.add_argument("--url", help="最初に開く URL（既定は config.json の oddspark_url）")
    args = ap.parse_args(argv)
    config_mod.ensure(args.config)
    try:
        cfg = config_mod.load(args.config)
    except config_mod.ConfigError as e:
        print(f"設定が読めません: {e}")
        return 2
    out = os.path.join(os.path.dirname(os.path.abspath(args.config)), "records", now().strftime("%Y%m%d_%H%M%S"))
    rec = Recorder(out)
    print(f"記録先: {out}")
    print("Chrome を起動しています（自動購入を動かしていたら、先に止めてください）…")
    stop = threading.Event()
    try:
        with browser.open_context(cfg) as (ctx, page):
            ctx.expose_binding("__kbRecord", rec.on_record)
            ctx.add_init_script(PROBE_JS)
            ctx.on("page", lambda p: (rec.note(f"[窓{rec.pid(p)}] 新しい窓が開いた（ポップアップ）"), rec.watch(p)))
            rec.watch(page)
            page.goto(args.url or cfg.oddspark_url)
            print("\n" + "=" * 60)
            print(" 開いた Chrome で、ふだんどおり手で操作してください。")
            print("  1. ログイン（ID・パスワード・暗証番号は記録しません）")
            print("  2. ためしたい投票画面を開く")
            print("  3. 場 → レース → 式別(3連複) → 車番3つ → 金額100円 → 確認画面 まで")
            print("     （購入まで押すかはおまかせ。押すと本当に買えます）")
            print("  4. 終わったら、この黒い画面で Enter")
            print("=" * 60 + "\n")
            threading.Thread(target=lambda: (input(), stop.set()), daemon=True).start()
            while not stop.is_set():
                pages = [p for p in ctx.pages if not p.is_closed()]
                if not pages:
                    rec.note("窓がすべて閉じられたので終わります")
                    break
                try:
                    pages[0].wait_for_timeout(300)     # この間に Chrome からの記録を受け取る
                except Exception:
                    time.sleep(0.3)
                rec.snap_due()
            for p in [p for p in ctx.pages if not p.is_closed()]:
                rec.snap(p)                            # 最後の画面も撮っておく
    except browser.BrowserUnavailable as e:
        print(e)
        return 2
    except KeyboardInterrupt:
        pass
    finally:
        rec.close()
    zpath = out + ".zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for fn in sorted(os.listdir(out)):
            z.write(os.path.join(out, fn), os.path.join(os.path.basename(out), fn))
    print(f"\n記録しました: {out}")
    print(f"まとめたもの: {zpath}")
    print("★見せる前に steps.txt と画像を開いて、残高・お名前・会員番号が写っていないか確かめてください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
