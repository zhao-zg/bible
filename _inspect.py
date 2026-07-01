import sqlite3, os, json
d = r'g:\project\github\bible\resource'
for fn in sorted(os.listdir(d)):
    fp = os.path.join(d, fn)
    if fn.endswith('.db'):
        conn = sqlite3.connect(fp)
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        sz = os.path.getsize(fp)//1024
        print(f'\n=== {fn} ({sz} KB) ===')
        for t in tables:
            tn = t[0]
            cols = conn.execute(f'PRAGMA table_info({tn})').fetchall()
            cnt = conn.execute(f'SELECT COUNT(*) FROM [{tn}]').fetchone()[0]
            print(f'  Table: {tn} ({cnt} rows)')
            for c in cols:
                print(f'    col: {c[1]} ({c[2]})')
        conn.close()
    elif fn.endswith('.json'):
        sz = os.path.getsize(fp)//1024
        print(f'\n=== {fn} ({sz} KB) ===')
        with open(fp, encoding='utf-8') as jf:
            data = json.load(jf)
        if isinstance(data, list):
            print(f'  Type: list, len={len(data)}')
            if data:
                fi = data[0]
                print(f'  First item keys: {list(fi.keys()) if isinstance(fi, dict) else type(fi)}')
        elif isinstance(data, dict):
            print(f'  Type: dict, keys={list(data.keys())[:10]}')
