#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把正版 APK 的「注解内可点区间」精确导入 resource/zh_rcv.db 与 zh_hant_rcv.db。

正版数据
────────
Bible20240820.sqlite 的 footnote_all_link_10（20,401 行）按字符区间登记注解里
哪一段可以点击；注解渲染只消费这张表，没有任何运行时扫描。我们的注解 / 串珠 /
经文与正版逐字相同，因此区间可以无损对到我们的 footnote 行上。

坐标语义（FootNoteFragment.setListView + FootNoteAdapter.getView 字节码）
────────────────────────────────────────────────────────────────────
1. 注解显示前先删掉全部段落符 ˍ；start_loc / end_loc 是「该节该 unit 的全部注解
   （去 ˍ）首尾相接」空间里的 [start_loc-1, end_loc)。
   早先把它当成「区间有累积漂移」是误读——不去 ˍ 才会错位。
2. unit=2（下半节）的坐标从 unit=1 的注解之后接着算，要先减去 unit=1 注解的总长。
3. 区间归属：第一个满足 end <= 累计长度 的注解。

对正版数据瑕疵的三处修正（前两处共 5 行，其余行坐标原样）
────────────────────────────────────────────────────
* 弗一18 下半节的 3 行：正版减的是 unit=1 注解的**原始**长度（含 ˍ），整体错后
  一位（「（11」）。这里按去 ˍ 的长度减，得到「11下」。
* 耶三一33 的 2 行整体错后一位（「后三3注4。」「八10注5。」），正版点开是空的。
  区间以句号结尾且前一个字能补全书卷缩写时左移一位。
* 区间首尾的标点 / 空白（「启二10注2，」）不计入可点范围。

输出
────
    footnote_link(_id, book_index, chapter, section, flag, note_id, seq, start, end, ord, text)
    footnote_link_meta(key, value)
start 为 0-based 起点、end 为排他终点，直接用于 footnote.note[start:end]。

用法
────
    python import_apk_links.py --apk-db "C:/Users/zzg/Desktop/Bible.apk/assets/Bible20240820.sqlite"
    python import_apk_links.py --apk-db ... --dry-run          # 只统计不写库
    python import_apk_links.py --apk-db ... --variant gb       # 只导入简体库
"""
from __future__ import annotations

import argparse
import collections
import datetime
import os
import shutil
import sqlite3
import sys
from typing import Dict, List, Tuple

PARA = "\u02cd"                       # 注解段落分隔符 ˍ
EDGE_CHARS = "，、；。：（）() \u3000\t\r\n" + PARA

VARIANTS = {
    # 变体: (正版注解表, 目标库文件)
    "gb": ("footnote_all_gb_27", "zh_rcv.db"),
    "big5": ("footnote_all_big5_09", "zh_hant_rcv.db"),
}


def _ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)


def locate_links(apk_db: str, note_table: str, project_db: str) -> Tuple[List[tuple], collections.Counter]:
    """按正版坐标算法把每个可点区间落到我们的 footnote 行上。

    返回 (rows, stats)；rows = (book, chapter, section, flag, note_id, seq, start, end, ord, text)。
    """
    stats: collections.Counter = collections.Counter()
    apk = _ro(apk_db)
    notes: Dict[tuple, List[Tuple[int, str]]] = collections.defaultdict(list)
    for b, c, v, u, num, txt in apk.execute(
        "SELECT chapter_code, section_code, segment_code, unit_code, note_num, note_content "
        "FROM %s ORDER BY id" % note_table
    ):
        notes[(b, c, v, u)].append((int(num), txt or ""))
    links: Dict[tuple, List[tuple]] = collections.defaultdict(list)
    for b, c, v, u, s, e in apk.execute(
        "SELECT chapter_code, section_code, segment_code, unit_code, start_loc, end_loc "
        "FROM footnote_all_link_10 ORDER BY rowid"
    ):
        links[(b, c, v, u)].append((s, e))
        stats["apk_rows"] += 1
    apk.close()

    ours = _ro(project_db)
    our_notes: Dict[tuple, List[Tuple[int, str]]] = collections.defaultdict(list)
    for nid, b, c, v, u, txt in ours.execute(
        "SELECT _id, book_index, chapter, section, flag, note FROM footnote ORDER BY _id"
    ):
        our_notes[(b, c, v, u)].append((int(nid), txt or ""))
    abbrs = {str(r[0]) for r in ours.execute("SELECT acronym_name FROM book_name") if r[0]}
    ours.close()

    found: List[tuple] = []
    for key in sorted(links):
        b, c, v, u = key
        rows, mine = notes.get(key, []), our_notes.get(key, [])
        if len(rows) != len(mine):
            stats["skip_group_mismatch"] += len(links[key])
            continue
        pre = max_num = 0
        if u == 2:                                   # 下半节：坐标接在上半节注解之后
            for num, txt in notes.get((b, c, v, 1), []):
                pre += len(txt.replace(PARA, ""))
                max_num = max(max_num, num)
        sizes, acc, shown = [], 0, []
        for i, (_num, raw) in enumerate(rows):
            acc += len(raw.replace(PARA, ""))
            sizes.append(acc)
            if raw:
                shown.append(i)                      # 正版只显示非空注解
        for s, e in links[key]:
            try:
                lo, hi = int(s) - 1 - pre, int(e) - pre
            except (TypeError, ValueError):
                stats["skip_bad_loc"] += 1
                continue
            pos = next((rows[i][0] - max_num for i, size in enumerate(sizes) if hi <= size), None)
            if pos is None or not 1 <= pos <= len(shown):
                stats["skip_no_note"] += 1
                continue
            idx = shown[pos - 1]
            raw = rows[idx][1]
            prev = sum(len(rows[i][1].replace(PARA, "")) for i in shown[:pos - 1])
            a, z = lo - prev, hi - prev
            plain = [k for k, ch in enumerate(raw) if ch != PARA]   # 去 ˍ 坐标 → 原文坐标
            if not 0 <= a < z <= len(plain):
                stats["skip_out_of_range"] += 1
                continue
            start, end = plain[a], plain[z - 1] + 1

            # 首尾标点不算可点范围；以句号结尾的是整体错后一位的行
            shifted = raw[end - 1] == "。"
            while start < end and raw[start] in EDGE_CHARS:
                start += 1
            while end > start and raw[end - 1] in EDGE_CHARS:
                end -= 1
            if start >= end:
                stats["skip_empty"] += 1
                continue
            if shifted and start > 0:
                if raw[start - 1:start + 1] in abbrs:        # 「林【后三3…」→「林后三3…」
                    start -= 1
                    stats["repaired_shift"] += 1
                elif raw[start - 1] in abbrs and raw[start] not in abbrs:
                    start -= 1                               # 「来【八10…」→「来八10…」
                    stats["repaired_shift"] += 1

            note_id, our_raw = mine[idx]
            if our_raw != raw:                               # 两库仅可能差首尾空白
                shift = raw.find(our_raw)
                if shift < 0 or start < shift or end - shift > len(our_raw):
                    stats["skip_text_mismatch"] += 1
                    continue
                start, end = start - shift, end - shift
            found.append((b, c, v, u, note_id, rows[idx][0], start, end, our_raw[start:end]))

    found.sort(key=lambda r: (r[4], r[6]))
    out: List[tuple] = []
    order: Dict[int, int] = collections.Counter()
    last_end: Dict[int, int] = {}
    for r in found:
        if r[6] < last_end.get(r[4], 0):                     # 正版区间互不重叠；防御性去重
            stats["skip_overlap"] += 1
            continue
        last_end[r[4]] = r[7]
        order[r[4]] += 1
        out.append(r[:8] + (order[r[4]], r[8]))
    stats["written"] = len(out)
    return out, stats


def write_links(project_db: str, rows: List[tuple], meta: Dict[str, str]) -> None:
    con = sqlite3.connect(project_db)
    try:
        cur = con.cursor()
        cur.execute("DROP TABLE IF EXISTS footnote_link")
        cur.execute(
            "CREATE TABLE footnote_link ("
            " _id INTEGER PRIMARY KEY,"
            " book_index INTEGER NOT NULL, chapter INTEGER NOT NULL,"
            " section INTEGER NOT NULL, flag INTEGER NOT NULL,"
            " note_id INTEGER NOT NULL, seq INTEGER NOT NULL,"
            " start INTEGER NOT NULL, end INTEGER NOT NULL,"
            " ord INTEGER NOT NULL, text TEXT NOT NULL)"
        )
        cur.executemany(
            "INSERT INTO footnote_link"
            "(book_index,chapter,section,flag,note_id,seq,start,end,ord,text)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            rows,
        )
        cur.execute("CREATE INDEX idx_footnote_link_loc ON footnote_link(note_id)")
        cur.execute("DROP TABLE IF EXISTS footnote_link_meta")
        cur.execute("CREATE TABLE footnote_link_meta (key TEXT PRIMARY KEY, value TEXT)")
        cur.executemany("INSERT INTO footnote_link_meta(key,value) VALUES (?,?)", list(meta.items()))
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="导入正版 APK 的注解可点区间",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    root = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--apk-db", required=True, help="Bible20240820.sqlite 路径")
    ap.add_argument("--variant", choices=sorted(VARIANTS) + ["all"], default="all",
                    help="gb=简体库 zh_rcv.db，big5=繁体库 zh_hant_rcv.db（默认都导入）")
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写库")
    ap.add_argument("--no-backup", action="store_true", help="跳过 .temp 备份")
    args = ap.parse_args()

    if not os.path.exists(args.apk_db):
        print("找不到 APK 数据库：%s" % args.apk_db)
        return 2
    for variant in (sorted(VARIANTS) if args.variant == "all" else [args.variant]):
        note_table, db_name = VARIANTS[variant]
        db = os.path.join(root, "resource", db_name)
        if not os.path.exists(db):
            print("找不到目标数据库：%s" % db)
            return 2
        rows, stats = locate_links(args.apk_db, note_table, db)
        print("[%s] %s" % (variant, db_name))
        print("  正版区间行          : %d" % stats["apk_rows"])
        print("  写入 footnote_link  : %d（%d 条注解）" % (len(rows), len({r[4] for r in rows})))
        print("  修正整体错位        : %d" % stats["repaired_shift"])
        for k in sorted(stats):
            if k.startswith("skip_"):
                print("  跳过 %-15s: %d" % (k[5:], stats[k]))
        if args.dry_run:
            continue
        if not args.no_backup:
            backup_dir = os.path.join(root, ".temp", "db-backup")
            os.makedirs(backup_dir, exist_ok=True)
            dst = os.path.join(backup_dir, "%s-%s.db" % (
                os.path.splitext(db_name)[0], datetime.datetime.now().strftime("%Y%m%d-%H%M%S")))
            shutil.copy2(db, dst)
            print("  已备份：%s" % dst)
        write_links(db, rows, {
            "source": os.path.basename(args.apk_db),
            "apk_table": "footnote_all_link_10",
            "imported_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "rows": str(len(rows)),
            "apk_rows": str(stats["apk_rows"]),
            "note": "start=0-based 起点, end=排他终点（footnote.note 原文坐标，含 ˍ）",
        })
        print("  写入完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
