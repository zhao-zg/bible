import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
d=json.load(open('g:/project/github/bible/output/data/strongs-dict.json','r',encoding='utf-8'))
print('Total entries:', len(d))
hk=[k for k in d if k.startswith('H')]
gk=[k for k in d if k.startswith('G')]
print('Hebrew:', len(hk), 'Greek:', len(gk))
print()
for k in ['H889','H7225','G595','G2424']:
    e = d.get(k, {})
    print(k, 'orig:', repr(e.get('o','')), 'txt:', str(e.get('t',''))[:50])
print()
ho = sum(1 for k in hk if d[k].get('o'))
go = sum(1 for k in gk if d[k].get('o'))
print('Hebrew with orig:', ho, '/', len(hk))
print('Greek with orig:', go, '/', len(gk))
