#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把权威 APK 的「注解内引经区间」导入 resource/zh_rcv.db。

背景
────
权威 APK 的 Bible20240820.sqlite 独有 footnote_all_link_10 表，按字符区间记录
注解正文中哪一段是经文引用（20,401 行）。我们的 zh_rcv.db 与其注解/串珠数据
在 (书, 章, 节, unit, loc, seq) 上 100% 对齐（见 docs/2026-11-23-…-reverse-engineering.md），
因此可无损导入。

为什么不能直接照抄 start_loc/end_loc
────────────────────────────────────
实测该区间与当前注解文本存在累积漂移（注解后来补了全角括号/句点而未重算偏移），
11,392 个可精确定位的 span 中仅 202 个完全吻合。因此本脚本以「区间文本」为准，
在目标注解正文里重新定位区间，得到校准后的 start/end。

定位算法
────────
1. 双向归一：繁体→简体（逐字 1:1）+ 去标点（保留逐字索引映射）。
2. 在归一后的正文里找归一后的区间文本，记录所有命中位置。
3. 命中多个时，选与权威 start_loc 提示最接近的一个；
   命中多个注时同理（用于推断该 span 属于哪一条注）。
4. 找不到时记入未匹配清单（不写入），并统计原因。

输出
────
zh_rcv.db 新增表：
    footnote_link(_id, book_index, chapter, section, flag, seq, start, end, ord, text)
    footnote_link_meta(key, value)
其中 start 为 0-based 起点、end 为排他终点，可直接用于 note_content[start:end]。

用法
────
    python import_apk_links.py --apk-db "C:/Users/zzg/Desktop/Bible.apk/assets/Bible20240820.sqlite"
    python import_apk_links.py --apk-db ... --dry-run        # 只统计不写库
    python import_apk_links.py --apk-db ... --db path/to/zh_rcv.db
"""
from __future__ import annotations

import argparse
import collections
import datetime
import os
import shutil
import sqlite3
import sys
from typing import Dict, List, Optional, Tuple

# ─── 繁→简 1:1 映射（与 ref_link_parser.TRAD_CHARS 保持同构；长度不变） ────────
TRAD_PHRASES = [("約壹", "约壹"), ("約貳", "约贰"), ("約參", "约参")]
TRAD_CHARS = str.maketrans({
    "創": "创", "書": "书", "詩": "诗", "傳": "传", "賽": "赛", "結": "结",
    "彌": "弥", "鴻": "鸿", "該": "该", "亞": "亚", "瑪": "玛", "約": "约",
    "羅": "罗", "門": "门", "來": "来", "猶": "犹", "啟": "启", "後": "后",
    "註": "注", "節": "节", "見": "见", "與": "与", "參": "参",
})

# 参与比较时剔除的标点/空白（不影响语义，也不影响索引映射）
SKIP_CHARS = set(
    "（）()「」『』［］[]{}<>“”\"'‘’"
    "，,。.；;：:、！？!?—-–~～·　 \t\r\n\u00a0\u3000"
    "ˍ"  # 注解段落分隔符
)

# 兜底繁→简表（当 APK 缺少 big5 对照表时使用）
FALLBACK_T2S = {
    "參": "参", "約": "约", "創": "创", "書": "书", "詩": "诗", "傳": "传",
    "賽": "赛", "結": "结", "彌": "弥", "鴻": "鸿", "該": "该", "亞": "亚",
    "瑪": "玛", "羅": "罗", "門": "门", "來": "来", "猶": "犹", "啟": "启",
    "後": "后", "註": "注", "節": "节", "見": "见", "與": "与", "靈": "灵",
    "聖": "圣", "經": "经", "們": "们", "這": "这", "裏": "里",
    "為": "为", "著": "着", "並": "并", "於": "于", "會": "会", "對": "对",
}


def build_t2s(apk_db: str) -> Dict[str, str]:
    """从权威库 big5/gb 双份注解逐字对照，学习本语料专用的繁→简映射。"""
    mapping: Dict[str, str] = dict(FALLBACK_T2S)
    try:
        con = sqlite3.connect("file:%s?mode=ro" % apk_db.replace("\\", "/"), uri=True)
        big5 = con.execute("SELECT id, note_content FROM footnote_all_big5_09 ORDER BY id").fetchall()
        gb = dict(con.execute("SELECT id, note_content FROM footnote_all_gb_27 ORDER BY id").fetchall())
        con.close()
    except sqlite3.Error:
        return mapping
    pairs: Dict[str, Dict[str, int]] = collections.defaultdict(dict)
    for _id, x in big5:
        y = gb.get(_id)
        x = x or ""
        y = y or ""
        if not y or len(x) != len(y):
            continue
        for cx, cy in zip(x, y):
            if cx != cy:
                d = pairs[cx]
                d[cy] = d.get(cy, 0) + 1
    for cx, d in pairs.items():
        mapping[cx] = max(d.items(), key=lambda kv: kv[1])[0]
    return mapping


def normalize(s: str, t2s: Dict[str, str]) -> Tuple[str, List[int]]:
    """繁→简 + 去标点/空白；返回 (归一字符串, 每个字符在原文中的下标)。"""
    out: List[str] = []
    idx: List[int] = []
    for i, ch in enumerate(s):
        if ch in SKIP_CHARS:
            continue
        out.append(t2s.get(ch, ch))
        idx.append(i)
    return "".join(out), idx


def find_all(hay: str, needle: str) -> List[int]:
    if not needle:
        return []
    res: List[int] = []
    pos = hay.find(needle)
    while pos >= 0:
        res.append(pos)
        pos = hay.find(needle, pos + 1)
    return res


# 数字字符（阿拉伯 + 中文数字），形状匹配时统一折叠为 "#"
NUMBER_CHARS = set("0123456789零〇○一二三四五六七八九十百千两")


def shape_map(s: str, t2s: Dict[str, str]) -> Tuple[str, List[Tuple[int, int]]]:
    """数字归一的“形状串”：连续数字折叠为单个 '#'，同时保留每个字符区间在原文的起止下标。

    用于区间文本与正文数字写法不一致（45，47 vs 四十五，四十七；7～25 vs 7～15）
    时仍能定位引用区域。
    """
    out: List[str] = []
    spans: List[Tuple[int, int]] = []
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if ch in SKIP_CHARS:
            i += 1
            continue
        c = t2s.get(ch, ch)
        if c in NUMBER_CHARS:
            j = i
            while j < n:
                cj = s[j]
                if cj in SKIP_CHARS:
                    j += 1
                    continue
                if t2s.get(cj, cj) not in NUMBER_CHARS:
                    break
                j += 1
            out.append("#")
            spans.append((i, j))
            i = j
            continue
        out.append(c)
        spans.append((i, i + 1))
        i += 1
    return "".join(out), spans


class LinkImporter:
    def __init__(self, apk_db: str, project_db: str) -> None:
        self.apk_db = apk_db
        self.project_db = project_db
        self.t2s = build_t2s(apk_db)
        self.stats = collections.Counter()
        self.unmatched: List[Tuple[tuple, str, str]] = []

    # ---------- 读取 ----------
    def _load(self) -> Tuple[Dict[tuple, List[Tuple[int, int, str]]], Dict[tuple, List[Tuple[int, int, str]]]]:
        con = sqlite3.connect("file:%s?mode=ro" % self.project_db.replace("\\", "/"), uri=True)
        notes: Dict[tuple, List[Tuple[int, int, str]]] = collections.defaultdict(list)
        for nid, b, ch, sec, flag, seq, note in con.execute(
            "SELECT _id, book_index, chapter, section, flag, COALESCE(seq,0), COALESCE(note,'') "
            "FROM footnote ORDER BY _id"
        ):
            notes[(int(b), int(ch), int(sec), int(flag or 0))].append((int(nid), int(seq), str(note)))
        con.close()
        for k in notes:
            notes[k].sort(key=lambda x: x[1])   # 按注号排序（同号按 _id 稳定）

        con = sqlite3.connect("file:%s?mode=ro" % self.apk_db.replace("\\", "/"), uri=True)
        spans: Dict[tuple, List[Tuple[int, int, str]]] = collections.defaultdict(list)
        for rowid, b, ch, sec, flag, s, e, txt in con.execute(
            "SELECT id, chapter_code, section_code, segment_code, unit_code, "
            "CAST(start_loc AS INTEGER), CAST(end_loc AS INTEGER), note FROM footnote_all_link_10 ORDER BY id"
        ):
            spans[(int(b), int(ch), int(sec), int(flag or 0))].append((int(s), int(e), str(txt or "")))
        con.close()
        return notes, spans

    # ---------- 定位 ----------
    def _locate_shape(self,
                      span_text: str,
                      notes: List[Tuple[int, str]],
                      hint_start: int) -> Optional[Tuple[int, int, int, int]]:
        """数字归一后的形状匹配（比裸偏移稳健，用于文本不一致的 span）。"""
        need, _ = shape_map(span_text, self.t2s)
        if not need or need == "#" and len(need) == 1:
            return None
        best = None
        for idx, (_nid, _seq, content) in enumerate(notes):
            hay, spans = shape_map(content, self.t2s)
            hits = find_all(hay, need)
            if not hits:
                continue
            pos = min(hits, key=lambda p: abs(p - (hint_start - 1)))
            dist = abs(pos - (hint_start - 1))
            start = spans[pos][0]
            end = spans[pos + len(need) - 1][1]
            if best is None or dist < best[3]:
                best = (idx, start, end, dist)
        return best

    def _locate(self,
                span_text: str,
                notes: List[Tuple[int, str]],
                hint_start: int) -> Optional[Tuple[int, int, int, int]]:
        """返回 (note_seq, start, end, 距离) ；找不到返回 None。"""
        need_norm, _ = normalize(span_text, self.t2s)
        if not need_norm:
            return None
        best = None
        for idx, (_nid, _seq, content) in enumerate(notes):
            hay_norm, idx_map = normalize(content, self.t2s)
            hits = find_all(hay_norm, need_norm)
            if not hits:
                continue
            pos = min(hits, key=lambda p: abs(p - (hint_start - 1)))
            dist = abs(pos - (hint_start - 1))
            start = idx_map[pos]
            end = idx_map[pos + len(need_norm) - 1] + 1
            if best is None or dist < best[3]:
                best = (idx, start, end, dist)
        return best

    # ---------- 主流程 ----------
    @staticmethod
    def _refine_parens(content: str, start: int, end: int) -> Tuple[int, int]:
        """偏移不稳时的括号吸附：若切片里残留未闭合的开括号，改取该括号内的内容。"""
        n = len(content)
        seg = content[start:end]
        if "（" in seg or "(" in seg:
            k = max(seg.rfind("（"), seg.rfind("("))
            abs_k = start + k
            close = min(
                [p for p in (content.find("）", abs_k + 1), content.find(")", abs_k + 1)) if p >= 0],
                default=-1,
            )
            if close > abs_k and close - abs_k <= 80 and close >= end - 2:
                return abs_k + 1, close
        return start, end

    @staticmethod
    def _snap(content: str, start: int, end: int) -> Tuple[int, int]:
        """吸附到引用的自然边界：去掉外层括号与尾随标点/句点。"""
        n = len(content)
        start = max(0, min(start, n))
        end = max(start, min(end, n))
        openers = "（(「『“‘"
        closers = "。）)，,、；;！？!?」』”’"
        while start < end and content[start] in openers:
            start += 1
        while end > start and content[end - 1] in closers:
            end -= 1
        return start, end

    def run(self, dry_run: bool) -> None:
        """权威库的 loc 是「该节该 unit 下所有注解串联后的全局字符坐标」，
        因此以串联空间做漂移校正，再换算回单条注文内的局部区间。"""
        notes, spans = self._load()
        self.stats["apk_spans"] = sum(len(v) for v in spans.values())
        self.stats["link_groups"] = len(spans)

        rows: List[tuple] = []
        for key, span_list in spans.items():
            note_list = notes.get(key)
            if not note_list:
                self.stats["group_no_note"] += 1
                continue

            # 注文边界（串联坐标）
            bounds: List[Tuple[int, int]] = []
            acc = 0
            for (_nid, _seq, content) in note_list:
                bounds.append((acc, acc + len(content)))
                acc += len(content)
            total_len = acc

            def to_note(cpos: int) -> Tuple[int, int]:
                for i, (a, b) in enumerate(bounds):
                    if a <= cpos < b:
                        return i, cpos - a
                i = len(note_list) - 1
                a, b = bounds[i]
                return i, min(max(cpos - a, 0), b - a)

            ordered = sorted(span_list, key=lambda x: x[0])

            # 第一轮：文本锚定
            items = []
            for (hint_s, hint_e, txt) in ordered:
                need, _ = normalize(txt, self.t2s)
                hit = self._locate(txt, note_list, hint_s) if need else None
                items.append({"hint": (hint_s, hint_e), "txt": txt,
                              "hit": hit, "empty": not need})
                if hit is not None:
                    idx, start, end, dist = hit
                    self.stats["anchor_text"] += 1
                    if dist == 0:
                        self.stats["anchor_text_exact"] += 1
                    a, _ = normalize(note_list[idx][2][start:end], self.t2s)
                    b, _ = normalize(txt, self.t2s)
                    if a != b:
                        self.stats["slice_mismatch"] += 1

            # 锚点在串联空间的漂移
            anchors: List[Tuple[int, int]] = []
            for it in items:
                if it["hit"]:
                    idx, start, _end, _d = it["hit"]
                    cpos = bounds[idx][0] + start
                    anchors.append((it["hint"][0], cpos - (it["hint"][0] - 1)))
            anchors.sort()

            def drift_at(hint: int) -> Optional[int]:
                if not anchors:
                    return None
                return min(anchors, key=lambda a: abs(a[0] - hint))[1]

            ord_by_idx: Dict[int, int] = collections.Counter()
            for it in items:
                hint_s, hint_e = it["hint"]
                if it["hit"]:
                    idx, start, end, _d = it["hit"]
                    quality = 0
                else:
                    shape = self._locate_shape(it["txt"], note_list, hint_s) if not it["empty"] else None
                    if shape is not None:
                        idx, start, end, _dist = shape
                        quality = 2
                    else:
                        drift = drift_at(hint_s)
                        quality = 3 if drift is None else 1
                        if it["empty"]:
                            quality = 4
                        d = drift or 0
                        cpos = hint_s - 1 + d
                        cend = hint_e + d
                        idx, local_s = to_note(max(0, min(cpos, total_len)))
                        idx2, local_e = to_note(max(0, min(cend, total_len)))
                        if idx2 != idx:      # 区间跨注（极少见）→ 截断到起点所在注
                            local_e = bounds[idx][1] - bounds[idx][0]
                        start, end = local_s, local_e

                content = note_list[idx][2]
                if quality in (1, 3, 4):
                    start, end = self._refine_parens(content, start, end)
                start, end = self._snap(content, start, end)
                if end <= start:
                    self.stats["dropped"] += 1
                    continue
                if quality == 4:
                    seg = content[start:end]
                    plausible = any(ch.isdigit() for ch in seg) or any(
                        ch in "创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多来雅彼犹启一二三四五六七八九十百○"
                        for ch in seg
                    )
                    if not plausible:
                        self.stats["empty_dropped"] += 1
                        continue
                    txt_out = seg          # 文本缺失，用校准后的切片回填
                else:
                    txt_out = it["txt"]

                self.stats["quality_%d" % quality] += 1
                ord_by_idx[idx] += 1
                nid, seq, _c = note_list[idx]
                rows.append((key[0], key[1], key[2], key[3], nid, seq,
                             start, end, ord_by_idx[idx], quality, txt_out))

        # 去重 + 包含归并：完全相同的区间只留一条；被更长区间完全覆盖的短区间丢弃
        final: List[tuple] = []
        by_note: Dict[int, List[tuple]] = collections.defaultdict(list)
        for r in rows:
            by_note[r[4]].append(r)
        for _nid, group in by_note.items():
            group.sort(key=lambda r: (r[6], -r[7]))
            kept: List[tuple] = []
            for r in group:
                start, end = r[6], r[7]
                skip = False
                for k in kept:
                    if start == k[6] and end == k[7]:
                        skip = True
                        self.stats["dedup_dup"] += 1
                        break
                    if start >= k[6] and end <= k[7]:
                        skip = True
                        self.stats["dedup_contained"] += 1
                        break
                if not skip:
                    kept.append(r)
            final.extend(kept)
        rows = []
        ord_counter: Dict[int, int] = collections.Counter()
        for r in sorted(final, key=lambda r: (r[4], r[6])):
            ord_counter[r[4]] += 1
            rows.append(r[:8] + (ord_counter[r[4]], r[9], r[10]))

        if dry_run:
            self._report()
            return

        # 事务写入
        con = sqlite3.connect(self.project_db)
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
                " ord INTEGER NOT NULL, quality INTEGER NOT NULL, text TEXT NOT NULL)"
            )
            cur.executemany(
                "INSERT INTO footnote_link"
                "(book_index,chapter,section,flag,note_id,seq,start,end,ord,quality,text)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
            cur.execute(
                "CREATE INDEX idx_footnote_link_loc"
                " ON footnote_link(note_id)"
            )
            cur.execute("DROP TABLE IF EXISTS footnote_link_meta")
            cur.execute("CREATE TABLE footnote_link_meta (key TEXT PRIMARY KEY, value TEXT)")
            qcnt = collections.Counter(r[9] for r in rows)
            meta = {
                "source": self.apk_db,
                "apk_table": "footnote_all_link_10",
                "imported_at": datetime.datetime.now().isoformat(timespec="seconds"),
                "rows": str(len(rows)),
                "apk_spans": str(self.stats["apk_spans"]),
                "q0_text_anchor": str(qcnt.get(0, 0)),
                "q1_drift": str(qcnt.get(1, 0)),
                "q2_shape": str(qcnt.get(2, 0)),
                "q3_raw": str(qcnt.get(3, 0)),
                "q4_text_missing": str(qcnt.get(4, 0)),
                "dedup_dup": str(self.stats["dedup_dup"]),
                "dedup_contained": str(self.stats["dedup_contained"]),
                "dropped": str(self.stats["dropped"]),
                "empty_dropped": str(self.stats["empty_dropped"]),
                "note": "start=0-based 起点, end=排他终点; quality 0=文本锚定 1=漂移估算 2=形状匹配 3=原始偏移 4=文本缺失回填",
            }
            cur.executemany("INSERT INTO footnote_link_meta(key,value) VALUES (?,?)", list(meta.items()))
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

        self._report()
        print("\n写入完成：footnote_link %d 行" % len(rows))

    def _report(self) -> None:
        s = self.stats
        total = s["apk_spans"]
        q0, q1, q2, q3, q4 = (s["quality_0"], s["quality_1"], s["quality_2"],
                              s["quality_3"], s["quality_4"])
        written = q0 + q1 + q2 + q3 + q4
        print("权威 link 行数          : %d（涉及 %d 个(节,unit)组）" % (total, s["link_groups"]))
        print("写入 footnote_link      : %d (%.2f%%)" % (written, written / max(1, total) * 100))
        print("  q0 文本锚定            : %d  其中完全吻合 %d" % (q0, s["anchor_text_exact"]))
        print("  q1 漂移估算（有文本）  : %d" % q1)
        print("  q2 数字归一形状匹配    : %d" % q2)
        print("  q3 原始偏移（未验证）  : %d" % q3)
        print("  q4 源文本缺失→切片回填 : %d" % q4)
        print("去重：重复 %d / 被包含 %d" % (s["dedup_dup"], s["dedup_contained"]))
        print("丢弃：吸附后为空 %d / 空白文本不可信 %d / 缺注文组 %d"
              % (s["dropped"], s["empty_dropped"], s["group_no_note"]))
        print("文本锚定切片校验失败    : %d" % s["slice_mismatch"])


def main() -> int:
    ap = argparse.ArgumentParser(description="导入权威 APK 的注解引经区间",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    root = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--apk-db", required=True, help="Bible20240820.sqlite 路径")
    ap.add_argument("--db", default=os.path.join(root, "resource", "zh_rcv.db"),
                    help="目标数据库（默认 resource/zh_rcv.db）")
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写库")
    ap.add_argument("--no-backup", action="store_true", help="跳过 .temp 备份")
    args = ap.parse_args()

    if not os.path.exists(args.apk_db):
        print("找不到 APK 数据库：%s" % args.apk_db)
        return 2
    if not os.path.exists(args.db):
        print("找不到目标数据库：%s" % args.db)
        return 2

    if not args.dry_run and not args.no_backup:
        backup_dir = os.path.join(root, ".temp", "db-backup")
        os.makedirs(backup_dir, exist_ok=True)
        dst = os.path.join(backup_dir, "zh_rcv-%s.db" % datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        shutil.copy2(args.db, dst)
        print("已备份：%s" % dst)

    LinkImporter(args.apk_db, args.db).run(args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
