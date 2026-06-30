import sqlite3, json
conn = sqlite3.connect('resource/s_.db')
conn.text_factory = str

# Check encoding
print("=== unv sample (first 5) ===")
rows = conn.execute("SELECT id, engs, chap, sec, txt FROM unv LIMIT 5").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:300])

print("\n=== hfhl sample (3) ===")
rows = conn.execute("SELECT hsnum, txt, orig FROM hfhl LIMIT 3").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:400])

print("\n=== gfhl sample (3) ===")
rows = conn.execute("SELECT gsnum, txt, orig FROM gfhl LIMIT 3").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:400])

print("\n=== fhlwhparsing sample (3) ===")
rows = conn.execute("SELECT * FROM fhlwhparsing LIMIT 3").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:400])

print("\n=== lparsing sample (2) ===")
rows = conn.execute("SELECT * FROM lparsing LIMIT 2").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:400])

print("\n=== main table ===")
rows = conn.execute("SELECT * FROM main LIMIT 5").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str))

# Check unv for NT (Matt)
print("\n=== unv NT sample ===")
rows = conn.execute("SELECT id, engs, chap, sec, txt FROM unv WHERE engs='Matt' LIMIT 3").fetchall()
for r in rows:
    print(json.dumps(r, ensure_ascii=False, default=str)[:400])

conn.close()
