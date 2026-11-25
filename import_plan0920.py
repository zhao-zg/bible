"""从官方 APK 的 Plan0920.sqlite 导出读经计划到 resource/plan-*.json。

正版计划库共 4 档周期（plan_index）：
    plan_one   一年一次     364 天
    plan_two   兩年一次     728 天
    plan_four  四個月一次   121 天
    plan_six   半年一次     182 天

每档每天两条记录：type=1 旧约、type=2 新约（当天读旧约一段 + 新约一段）。
表中字段名与语义不一致，需要按下面的映射读取：

    start_chapter  -> 书号（1-66），不是章
    start_section  -> 章节号
    strat_segment  -> 起始节（源库拼写如此）
    end_*          -> 对应的结束坐标

输出格式与项目 front-end 约定一致：
    {"book", "book_to", "chapter", "chapter_to", "section", "section_to", "d", "t"}
    d = 天序号（1 起），t = 1 旧约 / 2 新约

用法：
    python import_plan0920.py --apk-db "C:\\path\\Plan0920.sqlite" --out-dir resource
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Dict, List

PLANS = [
    ("plan_one", "plan-one.json", "一年一次"),
    ("plan_two", "plan-two.json", "两年一次"),
    ("plan_four", "plan-four.json", "四个月一次"),
    ("plan_six", "plan-six.json", "半年一次"),
]


def export_table(conn: sqlite3.Connection, table: str) -> List[dict]:
    rows = conn.execute(
        f"""
        SELECT day, type, start_chapter, start_section, strat_segment,
               end_chapter, end_section, end_segment
        FROM {table}
        ORDER BY day, type
        """
    ).fetchall()

    entries: List[dict] = []
    for day, typ, sb, sc, ss, eb, ec, es in rows:
        entries.append({
            "book": int(sb),
            "book_to": int(eb),
            "chapter": int(sc),
            "chapter_to": int(ec),
            "section": int(ss),
            "section_to": int(es),
            "d": int(day),
            "t": int(typ),
        })
    return entries


def validate(entries: List[dict], label: str) -> None:
    """基本完整性校验：天连续、每天两条、坐标有效、末条到启示录 22 章。"""
    if not entries:
        raise SystemExit(f"{label}: 空数据")

    days = sorted({e["d"] for e in entries})
    if days != list(range(1, days[-1] + 1)):
        missing = sorted(set(range(1, days[-1] + 1)) - set(days))
        raise SystemExit(f"{label}: 天序号不连续，缺 {missing[:10]}")

    per_day: Dict[int, int] = {}
    for e in entries:
        per_day[e["d"]] = per_day.get(e["d"], 0) + 1
    bad = [d for d, n in per_day.items() if n != 2]
    if bad:
        raise SystemExit(f"{label}: 这些天不是两条记录 {bad[:10]}")

    for e in entries:
        if not (1 <= e["book"] <= 66 and 1 <= e["book_to"] <= 66):
            raise SystemExit(f"{label}: 书号越界 {e}")
        if e["chapter"] < 1 or e["chapter_to"] < 1:
            raise SystemExit(f"{label}: 章号异常 {e}")
        # 跨卷条目（如王上 21 章 → 王下 1 章）chapter_to 会重置，只有同卷时才要求递增
        if e["book"] == e["book_to"] and e["chapter_to"] < e["chapter"]:
            raise SystemExit(f"{label}: 同卷章号倒序 {e}")
        if e["section"] < 1 or e["section_to"] < 1:
            raise SystemExit(f"{label}: 节号异常 {e}")

    last_new = [e for e in entries if e["t"] == 2 and e["d"] == days[-1]]
    if not last_new or last_new[0]["book_to"] != 66 or last_new[0]["chapter_to"] != 22:
        raise SystemExit(f"{label}: 末条未覆盖到启示录 22 章")

    print(f"  {label}: {len(entries)} 条 / {days[-1]} 天")
    print(f"    首日: {entries[0]}")
    print(f"    末日: {entries[-2]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apk-db", required=True, help="APK assets/Plan0920.sqlite 路径")
    ap.add_argument("--out-dir", default="resource", help="输出目录（默认 resource/）")
    args = ap.parse_args()

    db_path = Path(args.apk_db)
    if not db_path.exists():
        raise SystemExit(f"数据库不存在：{db_path}")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        for table, filename, label in PLANS:
            entries = export_table(conn, table)
            validate(entries, label)
            out = out_dir / filename
            out.write_text(
                json.dumps(entries, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            print(f"  -> {out} ({out.stat().st_size / 1024:.1f} KB)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())