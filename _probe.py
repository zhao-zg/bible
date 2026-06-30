import sqlite3, json
conn = sqlite3.connect('resource/s_.db')
cursor = conn.cursor()
cursor.execute('SELECT name, type FROM sqlite_master')
tables = [r[0] for r in cursor.fetchall() if r[1] == 'table']
print('Tables:', json.dumps(tables))
for t in tables:
    cols = conn.execute('PRAGMA table_info(' + t + ')').fetchall()
    cnt = conn.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]
    print('--- ' + t + ' ---')
    print('  Cols:', json.dumps([[c[1], c[2]] for c in cols]))
    print('  Count:', cnt)
    row = conn.execute('SELECT * FROM ' + t + ' LIMIT 1').fetchone()
    if row:
        print('  Sample:', [str(x)[:200] for x in row])
conn.close()
