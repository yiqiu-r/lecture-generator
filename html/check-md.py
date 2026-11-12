# -*- coding: utf-8 -*-
"""content3.md 校验：盒平衡 / 公式连续 / 泄漏标记 / $ 奇偶 / 小节重复"""
import io, re, sys

P = sys.argv[1] if len(sys.argv) > 1 else 'content3.md'   # 用法: python check-md.py [源.md]
raw = io.open(P, encoding='utf-8').read()
L = raw.split('\n')
ok = True

def bad(msg):
    global ok
    ok = False
    print('  [X]', msg)

print('== 1. 泄漏标记 ==')
leaked = False
for p in ['DSML', 'end▁of▁thinking', '<｜', 'thinking', 'Hmm,', 'Let me', 'TODO', '待补', '整理者']:
    n = raw.count(p)
    if n:
        bad(f'{p} 出现 {n} 次'); leaked = True
if not leaked:
    print('  无泄漏')

print('== 2. 盒平衡（按章）==')
blocks = re.split(r'^(## .*)$', raw, flags=re.M)
# blocks = ['', '## §3.1 …', body, '## §3.2 …', body, …]
allopen = allclose = 0
for k in range(1, len(blocks), 2):
    h = blocks[k].strip()
    o = c = 0
    for l in blocks[k+1].split('\n'):
        t = l.strip()
        if re.match(r'^:{3,}$', t):
            c += 1
        elif re.match(r'^:{3,}\S', t):   # :::def 形式（冒号后直接接字母）
            o += 1
    allopen += o; allclose += c
    print(f'  {"OK " if o==c else "X  "}{h[:34]:36s} 盒 {o}/{c}')
    if o != c:
        bad(f'{h} 盒不平衡')
print(f'  全册盒 {allopen}/{allclose}')

print('== 3. 冒号栈（孤立/未闭合）==')
stack = []; orphan = 0
for i, l in enumerate(L, 1):
    t = l.strip()
    m_close = re.match(r'^(:{3,})$', t)
    m_open = re.match(r'^(:{3,})\S', t)
    if m_close:
        n = len(m_close.group(1))
        if stack and stack[-1][0] == n:
            stack.pop()
        else:
            orphan += 1
    elif m_open:
        stack.append((len(m_open.group(1)), i))
if stack:
    bad(f'未闭合起始符 {len(stack)} 个: {stack[:5]}')
if orphan:
    bad(f'孤立结束符 {orphan} 个')
if not stack and not orphan:
    print('  栈干净')

print('== 4. 小节重复 ==')
for k in range(1, len(blocks), 2):
    h = blocks[k].strip()
    subs = re.findall(r'^### (.+)$', blocks[k+1], flags=re.M)
    dup = sorted({x for x in subs if subs.count(x) > 1})
    print(f'  {h[:34]:36s} 小节 {len(subs)} 个' + (f' 重复: {dup}' if dup else ''))
    if dup:
        bad(f'{h} 小节重复 {dup}')

print('== 5. 公式号连续（按 ## 节，跨 ### 连号）==')
for k in range(1, len(blocks), 2):
    h = blocks[k].strip()
    tags = [int(x) for x in re.findall(r'\\qquad\((\d+)\)', blocks[k+1])]
    seen = []
    for t in tags:
        if t not in seen:
            seen.append(t)
    if not seen:
        print(f'  -- {h[:24]:26s} 无编号公式')
        continue
    want = list(range(1, len(seen)+1))
    if seen != want:
        bad(f'{h} 公式号 {seen[:20]} != {want[:20]}')
    else:
        print(f'  OK {h[:24]:26s} (1)-({seen[-1]}) 共 {len(seen)} 个')

print('== 6. 逐行 $ 奇偶 ==')
odd = [(i, l[:70]) for i, l in enumerate(L, 1) if l.count('$') % 2 == 1]
if odd:
    bad(f'{len(odd)} 行 $ 计数为奇')
    for i, t in odd[:12]:
        print('     ', i, t)
else:
    print('  全部为偶')

print()
print('*** 全部通过 ***' if ok else '*** 有未通过项 ***')
sys.exit(0 if ok else 1)
