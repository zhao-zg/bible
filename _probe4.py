import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
conn = sqlite3.connect('resource/s_.db')
conn.text_factory = lambda b: b.decode('utf-8', errors='replace')

# Check if fhlwhparsing has any non-null sn/pro/wform/orig
print("=== fhlwhparsing non-null counts ===")
for col in ['sn','pro','wform','orig','word','exp']:
    cnt = conn.execute("SELECT COUNT(*) FROM fhlwhparsing WHERE " + col + " IS NOT NULL").fetchone()[0]
    print(f"  {col}: {cnt} non-null")

print("\n=== lparsing non-null counts ===")
for col in ['sn','pro','wform','orig','word','exp']:
    cnt = conn.execute("SELECT COUNT(*) FROM lparsing WHERE " + col + " IS NOT NULL").fetchone()[0]
    print(f"  {col}: {cnt} non-null")

# Check fhlwhparsing with actual word-level data
print("\n=== fhlwhparsing with sn not null ===")
rows = conn.execute("SELECT id, engs, chap, sec, wid, word, sn, pro, wform, orig, SUBSTR(exp,1,60) FROM fhlwhparsing WHERE sn IS NOT NULL LIMIT 5").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

print("\n=== lparsing with sn not null ===")
rows = conn.execute("SELECT id, engs, chap, sec, wid, word, sn, pro, wform, orig, SUBSTR(exp,1,60) FROM lparsing WHERE sn IS NOT NULL LIMIT 5").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

# Check gfhl with actual text
print("\n=== gfhl non-null counts ===")
for col in ['gsnum','txt','orig']:
    cnt = conn.execute("SELECT COUNT(*) FROM gfhl WHERE " + col + " IS NOT NULL").fetchone()[0]
    print(f"  {col}: {cnt} non-null")

print("\n=== gfhl with txt not null ===")
rows = conn.execute("SELECT gsnum, SUBSTR(txt,1,200), orig FROM gfhl WHERE txt IS NOT NULL LIMIT 3").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

# Estimate actual data sizes for parsing when split per-verse
print("\n=== Parsing data: average words per verse ===")
print("fhlwhparsing:", conn.execute("SELECT COUNT(DISTINCT engs||chap||sec) FROM fhlwhparsing").fetchone()[0], "unique verses")
print("lparsing:", conn.execute("SELECT COUNT(DISTINCT engs||chap||sec) FROM lparsing").fetchone()[0], "unique verses")

conn.close()
