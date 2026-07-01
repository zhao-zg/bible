import sqlite3, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
conn = sqlite3.connect(r'g:\project\github\bible\resource\EO.db')
tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print('Tables:', [t[0] for t in tables])
for t in tables:
    tn = t[0]
    cols = conn.execute(f'PRAGMA table_info({tn})').fetchall()
    cnt = conn.execute(f'SELECT COUNT(*) FROM [{tn}]').fetchone()[0]
    print(f'\nTable: {tn} ({cnt} rows)')
    for c in cols:
        print(f'  col: {c[1]} ({c[2]})')
    if cnt > 0:
        sample = conn.execute(f'SELECT * FROM [{tn}] LIMIT 2').fetchall()
        for s in sample:
            print(f'  sample: {str(s)[:200]}')
conn.close()
