#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""正版基准审计：构建产物 output/data/bible/*.json vs 正版 APK 字节码的解析结果。

做法
────
不是「我们的解析器解析正版文本」这种自证，而是把 APK 里的
ted.android.bibleread.tool.Quote（引经解析）原样跑在 JVM 上：
  1. dex2jar 把含 Quote 的 dex 转成 class，只取 Quote / MyTool / ChapterNode；
  2. java/ 下是 Android 侧依赖的替身（Context.getString、Log、TextUtils、MySave、
     SQLHelper——SQL 取自正版，直接查 APK 自带的 sqlite）；
  3. 按 FootNoteFragment / FootNoteAdapter 的坐标算法还原正版每个可点区间的显示文本，
     连同全部串珠原文喂给 Quote，得到正版点开后列出的经文行 / 注解行；
  4. 与我们构建产物里同一位置的 x（经文区间）/ n（注解指针）逐条比较。

用法（先 python main.py 构建）
────────────────────────────
    python tools/apk_oracle/audit.py --apk-dir "C:/Users/zzg/Desktop/Bible.apk"
    python tools/apk_oracle/audit.py --apk-dir ... --variant big5 --detail

--apk-dir 是解包后的 APK 目录（含 classes*.dex 与 assets/Bible20240820.sqlite）。
需要 JDK（java/javac）与 Maven（首次运行时下载 dex2jar、sqlite-jdbc）。
strings.tsv 是 Quote/MyTool 用到的 28 条字符串资源，id 与该版 APK 对应。
"""
from __future__ import annotations

import argparse
import bisect
import collections
import glob
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PARA = "\u02cd"
VARIANTS = {
    # 变体: (正版注解表, 正版串珠表, 我们的库, 产物分片目录, 界面语言, versions_42 下标)
    "gb": ("footnote_all_gb_27", "foot_all_gb_28", "zh_rcv.db", ("bible",), "cn", 1),
    "big5": ("footnote_all_big5_09", "foot_all_big5_11", "zh_hant_rcv.db", ("bible", "zh-hant-rcv"), "tw", 0),
}
APP_CLASSES = [
    "ted/android/bibleread/tool/Quote.class",
    "ted/android/bibleread/tool/MyTool.class",
    "ted/android/bibleread/read/ChapterNode.class",
]


def sh(cmd, **kw):
    subprocess.run(cmd, check=True, **kw)


def prepare(apk_dir: str, work: str) -> str:
    """准备运行环境，返回 java 的 classpath。"""
    lib = os.path.join(work, "lib")
    if not glob.glob(os.path.join(lib, "sqlite-jdbc-*.jar")):
        mvn = shutil.which("mvn") or shutil.which("mvn.cmd")
        if not mvn:
            sys.exit("需要 Maven 下载 dex2jar / sqlite-jdbc（mvn 不在 PATH）")
        sh([mvn, "-q", "-B", "-f", os.path.join(HERE, "pom.xml"),
            "dependency:copy-dependencies", "-DoutputDirectory=" + lib])
    jdbc = glob.glob(os.path.join(lib, "sqlite-jdbc-*.jar"))[0]
    appmin = os.path.join(work, "appmin")
    if not os.path.exists(os.path.join(appmin, APP_CLASSES[0])):
        dex = next((p for p in sorted(glob.glob(os.path.join(apk_dir, "classes*.dex")))
                    if b"Lted/android/bibleread/tool/Quote;" in open(p, "rb").read()), None)
        if not dex:
            sys.exit("在 %s 的 classes*.dex 里找不到 Quote 类" % apk_dir)
        jar = os.path.join(work, "app.jar")
        sh(["java", "-cp", os.path.join(lib, "*"), "com.googlecode.dex2jar.tools.Dex2jarCmd",
            "-f", "-o", jar, dex], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with zipfile.ZipFile(jar) as z:
            for name in APP_CLASSES:
                z.extract(name, appmin)
    classes = os.path.join(work, "classes")
    stamp = os.path.join(classes, "oracle", "Main.class")
    sources = glob.glob(os.path.join(HERE, "java", "**", "*.java"), recursive=True)
    if not os.path.exists(stamp) or os.path.getmtime(stamp) < max(os.path.getmtime(s) for s in sources):
        sh(["javac", "-encoding", "UTF-8", "-nowarn", "-cp", os.pathsep.join([appmin, jdbc]),
            "-d", classes] + sources)
    return os.pathsep.join([classes, appmin, jdbc])


def run_oracle(classpath: str, apk_db: str, variant: str, src: str, dst: str) -> None:
    lang, select_book = VARIANTS[variant][4:6]
    # dex2jar 产物没有 StackMapTable，需关闭字节码校验
    sh(["java", "-XX:+UnlockDiagnosticVMOptions", "-XX:-BytecodeVerificationRemote",
        "-Dfile.encoding=UTF-8", "-cp", classpath, "oracle.Main", apk_db,
        os.path.join(HERE, "strings.tsv"), lang, str(select_book), src, dst])


def official_links(apk: sqlite3.Connection, note_table: str):
    """按正版坐标算法还原每个可点区间：(行号, 书, 章, 节, 注号, 原文起点, 终点, 显示文本)。"""
    notes = collections.defaultdict(list)
    for b, c, v, u, num, txt in apk.execute(
            "SELECT chapter_code, section_code, segment_code, unit_code, note_num, note_content "
            "FROM %s ORDER BY id" % note_table):
        notes[(b, c, v, u)].append((int(num), txt or ""))
    links = collections.defaultdict(list)
    for rid, b, c, v, u, s, e in apk.execute(
            "SELECT rowid, chapter_code, section_code, segment_code, unit_code, start_loc, end_loc "
            "FROM footnote_all_link_10 ORDER BY rowid"):
        links[(b, c, v, u)].append((rid, s, e))
    out = []
    for (b, c, v, u), rows_l in sorted(links.items()):
        rows = notes.get((b, c, v, u), [])
        pre = max_num = 0
        if u == 2:
            for num, txt in notes.get((b, c, v, 1), []):
                pre += len(txt)                      # 正版此处用原始长度（含 ˍ）
                max_num = max(max_num, num)
        sizes, acc, shown = [], 0, []
        for i, (_n, raw) in enumerate(rows):
            acc += len(raw.replace(PARA, ""))
            sizes.append(acc)
            if raw:
                shown.append(i)
        for rid, s, e in rows_l:
            try:
                lo, hi = int(s) - 1 - pre, int(e) - pre
            except (TypeError, ValueError):
                continue
            pos = next((rows[i][0] - max_num for i, size in enumerate(sizes) if hi <= size), None)
            if pos is None or not 1 <= pos <= len(shown):
                continue
            idx = shown[pos - 1]
            raw = rows[idx][1]
            prev = sum(len(rows[i][1].replace(PARA, "")) for i in shown[:pos - 1])
            plain = [k for k, ch in enumerate(raw) if ch != PARA]
            a, z = lo - prev, hi - prev
            if not 0 <= a < z <= len(plain):
                continue                             # 正版 setSpan 越界 / 空区间
            start, end = plain[a], plain[z - 1] + 1
            out.append((rid, b, c, v, rows[idx][0], start, end, raw[start:end].replace(PARA, "\n\n")))
    return out


def load_oracle(path: str):
    res = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            verses, notes = set(), set()
            for tok in p[2].split():
                t = tok.split(":")
                if t[0] == "V":
                    verses.add((int(t[1]), int(t[2]), int(t[3])))
                else:
                    notes.add((int(t[1]), int(t[2]), int(t[3]), int(t[5])))
            res[p[0]] = (p[1], verses, notes)
    return res


class Product:
    """构建产物（某一语言的 66 个分片）。"""

    RANK = {0: 0, 1: 1, 3: 2, 2: 3}

    def __init__(self, shard_dir: str) -> None:
        self.acr, self.notes, self.beads, rows = {}, {}, {}, []
        for b in range(1, 67):
            with open(os.path.join(shard_dir, "%02d.json" % b), encoding="utf-8") as f:
                d = json.load(f)
            self.acr[b] = d["book_acronym"]
            for ch in d["chapters"]:
                for v in ch["verses"]:
                    rows.append((b * 1000000 + ch["chapter"] * 1000 + v["section"], v.get("flag", 0),
                                 b, ch["chapter"], v["section"]))
                    for fn in v.get("footnotes") or []:
                        self.notes.setdefault((b, ch["chapter"], v["section"], fn["seq"]),
                                              (fn.get("note", ""), fn.get("refs") or []))
                    for bd in v.get("beads") or []:
                        self.beads.setdefault((b, ch["chapter"], v["section"], bd["seq"]), bd)
        self.rows = sorted(rows, key=lambda t: (t[0], t[1]))
        self.keys = [t[0] for t in self.rows]

    def expand(self, xs) -> set:
        """x 编码 → {(书,章,节)}；与 scripture-popup.js 的 expandRanges 同算法。"""
        out = set()
        for part in str(xs or "").split(";"):
            if not part:
                continue
            n = [int(t) for t in part.split(",")]
            title = len(n) == 2
            if len(n) == 2:
                b1, c1, v1, u1, b2, c2, v2, u2 = n[0], n[1], 0, 0, n[0], n[1], 0, 0
            elif len(n) == 3:
                b1, c1, v1, u1, b2, c2, v2, u2 = n[0], n[1], n[2], 0, n[0], n[1], n[2], 0
            elif len(n) == 4:
                b1, c1, v1, u1, b2, c2, v2, u2 = n[0], n[1], n[2], n[3], n[0], n[1], n[2], n[3]
            elif len(n) == 6:
                b1, c1, v1, u1, b2, c2, v2, u2 = n[0], n[1], n[2], 0, n[3], n[4], n[5], 0
            elif len(n) == 8:
                b1, c1, v1, u1, b2, c2, v2, u2 = n
            else:
                continue
            lo = b1 * 1000000 + c1 * 1000 + (v1 or 0)
            hi = b2 * 1000000 + c2 * 1000 + (v2 or 999)
            picked = []
            for i in range(bisect.bisect_left(self.keys, lo), bisect.bisect_right(self.keys, hi)):
                p, u, b, c, v = self.rows[i]
                if (v != 0) if title else (v == 0 and p == lo):
                    continue
                picked.append((p, u, b, c, v))
            rank = self.RANK
            if v1 and u1 and any(p == lo and rank[u] >= rank[u1] for p, u, *_ in picked):
                picked = [t for t in picked if not (t[0] == lo and rank[t[1]] < rank[u1])]
            if v2 and u2 and any(p == hi and rank[u] <= rank[u2] for p, u, *_ in picked):
                picked = [t for t in picked if not (t[0] == hi and rank[t[1]] > rank[u2])]
            out.update((b, c, v) for _p, _u, b, c, v in picked)
        return out

    @staticmethod
    def pointers(ns) -> set:
        out = set()
        for part in str(ns or "").split(";"):
            if part:
                n = [int(t) for t in part.split(",")]
                out.add((n[0], n[1], n[2], n[3]))
        return out


def classify(status, o_v, o_n, m_v, m_n) -> str:
    if o_v == m_v and o_n == m_n:
        return "一致"
    if status == "EXC":
        return "正版闪退（我们正常）"
    if not o_v and not o_n:
        return "正版点开为空（我们有结果）"
    if not m_v and not m_n:
        return "我们点开为空"
    if o_v == m_v:
        return "注解·我们多" if o_n < m_n else ("注解·我们少" if m_n < o_n else "注解·不同")
    if m_v < o_v:
        return "经文·我们少"
    if o_v < m_v:
        return "经文·我们多"
    return "经文·部分重叠" if o_v & m_v else "经文·完全不同"


def audit(variant: str, apk_dir: str, work: str, classpath: str, detail: bool) -> None:
    note_tbl, bead_tbl, db_name, shard_rel = VARIANTS[variant][:4]
    apk_db = os.path.join(apk_dir, "assets", "Bible20240820.sqlite")
    apk = sqlite3.connect("file:%s?mode=ro" % apk_db.replace("\\", "/"), uri=True)

    links = official_links(apk, note_tbl)
    beads = [(rid, b, c, v, (letter or "").strip().strip('"'), (txt or "").strip().strip('"'))
             for rid, b, c, v, letter, txt in apk.execute(
                 "SELECT id, chapter_code, section_code, segment_code, beaded, Beaded_content "
                 "FROM %s ORDER BY id" % bead_tbl)]
    src, dst = os.path.join(work, "in_%s.tsv" % variant), os.path.join(work, "out_%s.tsv" % variant)
    with open(src, "w", encoding="utf-8", newline="\n") as f:
        for rid, b, c, v, _num, _s, _e, text in links:
            f.write("L%d\t%d\t%d\t%d\t%s\n" % (rid, b, c, v, text.replace("\t", " ").replace("\n", "\\n")))
        for rid, b, c, v, _letter, text in beads:
            f.write("B%d\t%d\t%d\t%d\t%s\n" % (rid, b, c, v, text.replace("\t", " ").replace("\n", "\\n")))
    run_oracle(classpath, apk_db, variant, src, dst)
    oracle = load_oracle(dst)

    prod = Product(os.path.join(ROOT, "output", "data", *shard_rel))
    acr = prod.acr

    def fmt(verses, notes):
        s = " ".join("%s%d:%d" % (acr[b], c, v) for b, c, v in sorted(verses)[:8])
        if len(verses) > 8:
            s += " …(%d)" % len(verses)
        if notes:
            s += " | " + " ".join("%s%d:%d注%d" % (acr[b], c, v, n) for b, c, v, n in sorted(notes)[:6])
            if len(notes) > 6:
                s += " …(%d)" % len(notes)
        return s

    # 1. 可点位置
    regions = collections.defaultdict(list)
    ours = sqlite3.connect(os.path.join(ROOT, "resource", db_name))
    for b, c, v, seq, s, e in ours.execute(
            "SELECT book_index, chapter, section, seq, start, end FROM footnote_link"):
        regions[(b, c, v, seq)].append((s, e))
    spans = outside = 0
    for key, (_note, refs) in prod.notes.items():
        for r in refs:
            spans += 1
            if not any(s <= r["s"] and r["e"] <= e for s, e in regions.get(key, [])):
                outside += 1
    uncovered = sum(1 for key, regs in regions.items() for s, e in regs
                    if not any(r["e"] > s and r["s"] < e for r in prod.notes.get(key, ("", []))[1]))
    print("═══ [%s] 1. 可点位置 ═══" % variant)
    print("  正版可点区间              %d（另有 %d 行正版自身越界/无归属，不可点）"
          % (len(links), apk.execute("SELECT COUNT(*) FROM footnote_all_link_10").fetchone()[0] - len(links)))
    print("  产物可点 span             %d" % spans)
    print("  落在正版区间之外的 span   %d" % outside)
    print("  没有 span 覆盖的正版区间  %d" % uncovered)

    # 2. 注解区间 / 3. 串珠 点开后的目标
    def report(title, rows):
        cat = collections.Counter()
        det = collections.defaultdict(list)
        for at, text, status, o_v, o_n, m_v, m_n in rows:
            k = classify(status, o_v, o_n, m_v, m_n)
            cat[k] += 1
            if k != "一致":
                det[k].append((at, text, fmt(o_v, o_n), fmt(m_v, m_n)))
        print("═══ [%s] %s（%d）═══" % (variant, title, len(rows)))
        for k, n in cat.most_common():
            print("  %-26s %6d  %.2f%%" % (k, n, n * 100.0 / max(1, len(rows))))
        if detail:
            for k, rs in sorted(det.items(), key=lambda kv: -len(kv[1])):
                print("\n  ── %s (%d) ──" % (k, len(rs)))
                for at, text, o, m in rs[:12]:
                    print("    %-15s %r" % (at, text[:70]))
                    print("         正版: %s" % o)
                    print("         我们: %s" % m)

    rows = []
    for rid, b, c, v, num, s, e, text in links:
        status, o_v, o_n = oracle["L%d" % rid]
        refs = prod.notes.get((b, c, v, num), ("", []))[1]
        # 对到导入后的区间（导入时修正过错位的几行与原坐标差 1 位，取交叠最大的）
        best = max(regions.get((b, c, v, num), []), default=None,
                   key=lambda g: min(g[1], e) - max(g[0], s))
        m_v, m_n = set(), set()
        for r in refs:
            if best and best[0] <= r["s"] and r["e"] <= best[1]:
                m_v |= prod.expand(r.get("x"))
                m_n |= prod.pointers(r.get("n"))
        rows.append(("%s%d:%d 注%d" % (acr[b], c, v, num), text, status, o_v, o_n, m_v, m_n))
    report("2. 注解区间点开后的目标", rows)

    rows = []
    for rid, b, c, v, letter, text in beads:
        status, o_v, o_n = oracle["B%d" % rid]
        bd = prod.beads.get((b, c, v, letter)) or {}
        rows.append(("%s%d:%d 串%s" % (acr[b], c, v, letter), text, status, o_v, o_n,
                     prod.expand(bd.get("xr")), prod.pointers(bd.get("nr"))))
    report("3. 串珠点开后的目标", rows)


def main() -> int:
    ap = argparse.ArgumentParser(description="构建产物 vs 正版 APK 字节码的引经解析审计")
    ap.add_argument("--apk-dir", required=True, help="解包后的 APK 目录")
    ap.add_argument("--variant", choices=sorted(VARIANTS) + ["all"], default="all")
    ap.add_argument("--work", default=os.path.join(ROOT, ".temp", "apk_oracle"), help="中间文件目录")
    ap.add_argument("--detail", action="store_true", help="列出每类差异的样本")
    args = ap.parse_args()
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    os.makedirs(args.work, exist_ok=True)
    classpath = prepare(args.apk_dir, args.work)
    for variant in (sorted(VARIANTS) if args.variant == "all" else [args.variant]):
        audit(variant, args.apk_dir, args.work, classpath, args.detail)
    return 0


if __name__ == "__main__":
    sys.exit(main())
