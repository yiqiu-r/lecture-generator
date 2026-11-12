"""check_tpl.py — 「随机积分讲义」模板成品的静态校验。

用法: python check_tpl.py 成品.html
检查项:
  1. 未闭合盒标记 ::: 残留
  2. 目录锚点全部命中
  3. id 无重复
  4. $$ 块成对、\\begin/\\end 环境配对、\\left/\\right 配对
  5. thmbox 必须有 thm-title
  6. 行内 $ 成对（按段落）
  7. 标题层级齐全（h1/h2）
"""
import io
import re
import sys
from collections import Counter

path = sys.argv[1] if len(sys.argv) > 1 else 'out.html'
html = io.open(path, encoding='utf-8').read()
fails = []


def section(name, ok, detail=''):
    print('== %s ==' % name)
    print(('  OK  ' if ok else '  FAIL  ') + detail)
    if not ok:
        fails.append(name)


# 1. 残留盒标记
left = [ln for ln in html.split('\n') if re.match(r'^\s*:{3,}\s*[A-Za-z]*', ln)]
section('1. 盒标记残留', not left, '残留 %d 行 %s' % (len(left), left[:3]))

# 2. 目录锚点
anchors = re.findall(r'href="#([^"]+)"', html)
ids = set(re.findall(r'id="([^"]+)"', html))
missing = [a for a in anchors if a not in ids]
section('2. TOC 锚点', not missing, '锚点 %d 个，缺失 %s' % (len(anchors), missing))

# 3. id 重复
dups = [k for k, v in Counter(re.findall(r'id="([^"]+)"', html)).items() if v > 1]
section('3. id 唯一', not dups, '重复 %s' % dups)

# 4. 数学环境配对
dollar_blocks = re.findall(r'\$\$(.+?)\$\$', html, re.S)
bad_env, bad_left, bad_brace = [], [], []
for b in dollar_blocks:
    begins = re.findall(r'\\begin\{(\w+\*?)\}', b)
    ends = re.findall(r'\\end\{(\w+\*?)\}', b)
    if Counter(begins) != Counter(ends):
        bad_env.append(b[:60])
    if b.count('\\left') != b.count('\\right'):
        bad_left.append(b[:60])
    if b.count('{') != b.count('}'):
        bad_brace.append(b[:60])
section('4a. 数学环境配对', not bad_env, '$$ 块 %d 个，异常 %s' % (len(dollar_blocks), bad_env[:2]))
section('4b. left/right 配对', not bad_left, '异常 %s' % (bad_left[:2],))
section('4c. 花括号平衡', not bad_brace, '异常 %s' % (bad_brace[:2],))

# 5. thmbox 标题（带 id 的盒子也要算进来：<div class="thmbox" id="thm-5.1.1">）
starts = [m.start() for m in re.finditer(r'<div class="thmbox"', html)]
boxes = []
for i, s in enumerate(starts):
    e = starts[i + 1] if i + 1 < len(starts) else len(html)
    boxes.append(html[s:e])
no_title = [b[:50] for b in boxes if 'class="thm-title"' not in b]
section('5. thmbox 标题', not no_title, '盒子 %d 个，缺标题 %d' % (len(boxes), len(no_title)))

# 6. 公式是否全部渲染（KaTeX 构建期已渲完，正文里不该再有 $...$ / $$...$$）
residual = re.findall(r'\$[^$\n]{1,120}\$', html) + re.findall(r'\$\$', html)
section('6. 公式无残留 $', not residual, '残留 %d 处' % len(residual))

# 7. 标题
h1 = len(re.findall(r'<h1 class="book-title"', html))
h2 = len(re.findall(r'<h2 class="section"', html))
section('7. 标题层级', h1 == 1 and h2 >= 1, 'h1=%d h2=%d' % (h1, h2))

print()
if fails:
    print('*** 有未通过项: %s ***' % fails)
    sys.exit(1)
print('*** 全部通过 ***')
