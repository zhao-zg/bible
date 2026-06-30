import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
conn = sqlite3.connect('resource/s_.db')
conn.text_factory = lambda b: b.decode('utf-8', errors='replace')

# unv: Strong's tags pattern
print("=== unv NT (Matt) sample ===")
rows = conn.execute("SELECT id, engs, chap, sec, txt FROM unv WHERE engs='Matt' LIMIT 2").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:500])

print("\n=== unv OT (Gen) sample ===")
rows = conn.execute("SELECT id, engs, chap, sec, txt FROM unv WHERE engs='Gen' LIMIT 2").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:500])

print("\n=== hfhl sample ===")
rows = conn.execute("SELECT hsnum, SUBSTR(txt,1,200) FROM hfhl LIMIT 2").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

print("\n=== gfhl sample ===")
rows = conn.execute("SELECT gsnum, SUBSTR(txt,1,200) FROM gfhl LIMIT 2").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

print("\n=== fhlwhparsing (NT) sample ===")
rows = conn.execute("SELECT id, engs, chap, sec, wid, word, sn, pro, wform, orig, SUBSTR(exp,1,80), remark FROM fhlwhparsing WHERE engs='Matt' LIMIT 3").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

print("\n=== lparsing (OT) sample ===")
rows = conn.execute("SELECT id, engs, chap, sec, wid, SUBSTR(word,1,80), sn, pro, wform, orig, SUBSTR(exp,1,80), remark FROM lparsing WHERE engs='Gen' LIMIT 2").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

# Check Strong's tag format patterns
print("\n=== Strong's tag patterns in unv ===")
rows = conn.execute("SELECT txt FROM unv WHERE engs='Matt' AND sec=1 LIMIT 1").fetchall()
for r in rows:
    import re
    tags = re.findall(r'<W[^>]+>', r[0])
    print("Tags:", tags[:20])

# main table
print("\n=== main table (all 66) ===")
rows = conn.execute("SELECT engs, id FROM main ORDER BY id").fetchall()
print(json.dumps(rows, ensure_ascii=False, default=str))

# Size estimates
print("\n=== Size estimates ===")
for t in ['unv','hfhl','gfhl','fhlwhparsing','lparsing']:
    cnt = conn.execute("SELECT COUNT(*) FROM " + t).fetchone()[0]
    total_len = conn.execute("SELECT SUM(LENGTH(txt)) FROM " + t if t in ['unv','hfhl','gfhl'] else "SELECT SUM(LENGTH(word) + LENGTH(COALESCE(exp,'')) + LENGTH(COALESCE(pro,'')) + LENGTH(COALESCE(orig,''))) FROM " + t).fetchone()[0]
    print(f"  {t}: {cnt} rows, ~{total_len/1024/1024:.1f} MB text")

conn.close()
