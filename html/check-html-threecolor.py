# -*- coding: utf-8 -*-
"""三色版 HTML 校验：katex-err / 孤立 ::: / section 平衡 / TOC 锚点 / 残留 $"""
import io, os, re, sys

# 用法: python check-html-threecolor.py <讲义.html>
# 不设默认路径：成品位置随项目变，猜出来的默认值只会指向上一本书。
if len(sys.argv) < 2:
    print('用法: python check-html-threecolor.py <讲义.html>')
    sys.exit(2)
P = sys.argv[1]
s = io.open(P, encoding='utf-8').read()
ok = True

def chk(name, cond, detail=''):
    global ok
    print(('  OK  ' if cond else '  [X] ') + name + ('  ' + detail if detail else ''))
    if not cond:
        ok = False

print('== 1. KaTeX 错误 ==')
n = len(re.findall(r'<span class="katex-err">', s))   # 只看真正的错误 span，不算 CSS 类定义
chk('katex-err span = 0', n == 0, f'实际 {n}')

print('== 2. 孤立盒标记 ==')
lines = s.split('\n')
resid = [i for i, l in enumerate(lines, 1) if l.strip().startswith(':::')]
chk('行首 ::: 残留 = 0', len(resid) == 0, f'实际 {len(resid)} 行: {resid[:5]}')

print('== 3. section 平衡 ==')
o = len(re.findall(r'<section\b', s))
c = len(re.findall(r'</section>', s))
chk(f'<section>={o} </section>={c}', o == c)

print('== 4. 盒子类型统计 ==')
from collections import Counter
cnt = Counter(re.findall(r'<section class="box box-([a-z]+)"', s))
print('   ', dict(cnt), ' 合计', sum(cnt.values()))

print('== 5. TOC 锚点 ==')
toc = re.findall(r'<a class="toc-lv(\d)" href="#([^"]+)">', s)
ids = set(re.findall(r'<h[1-6] id="([^"]+)"', s))
miss = [t for _, t in toc if t not in ids]
chk(f'TOC 锚点 {len(toc)} 个全部命中', not miss, f'缺 {miss[:5]}')
print('   锚点总数', len(ids), ' lv2', sum(1 for l, _ in toc if l == '2'),
      ' lv3', sum(1 for l, _ in toc if l == '3'))

print('== 6. 残留 $ 与裸 LaTeX ==')
odd = [i for i, l in enumerate(lines, 1) if l.count('$') % 2 == 1]
chk('无奇数 $ 行', not odd, f'{len(odd)} 行: {odd[:5]}')
bare = re.findall(r'\\qquad|\\(?:frac|mathbf|mathfrak|int|lim)\b', s)
chk('无未渲染 LaTeX 命令', not bare, f'例如 {bare[:3]}')

print('== 7. 小节/标题 ==')
h2 = re.findall(r'<h2 id="[^"]+">(.+?)</h2>', s)
h3 = re.findall(r'<h3 id="[^"]+">(.+?)</h3>', s)
for t in h2:
    print('   ## ', re.sub(r'<[^>]+>', '', t))
for t in h3:
    print('      ### ', re.sub(r'<[^>]+>', '', t)[:52])

print('== 8. 体积与公式数 ==')
print(f'   文件 {len(s)/1024:.0f} KB')

print()
print('*** 全部通过 ***' if ok else '*** 有未通过项 ***')
sys.exit(0 if ok else 1)
