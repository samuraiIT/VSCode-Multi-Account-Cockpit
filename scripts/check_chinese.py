#!/usr/bin/env python3
import os, re, sys

CHINESE_RE = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf]')
src_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src')
skip_translations = '--all' not in sys.argv

count = 0
for root, dirs, files in os.walk(src_dir):
    dirs[:] = [d for d in dirs if d != 'node_modules']
    for fname in files:
        if not (fname.endswith('.ts') or fname.endswith('.js')):
            continue
        fpath = os.path.join(root, fname)
        if skip_translations and 'translations' in fpath:
            continue
        with open(fpath, encoding='utf-8', errors='replace') as f:
            for i, line in enumerate(f, 1):
                if CHINESE_RE.search(line):
                    rel = os.path.relpath(fpath, src_dir)
                    print(f'{rel}:{i}: {line.rstrip()}')
                    count += 1

print(f'\nTotal: {count} lines with Chinese')
