# -*- coding: utf-8 -*-
"""把 contentN.md 转成 LaTeX 正文，套 _base.tex 的版式。

设计要点：
1. 盒类型 → 自定义 tcolorbox 环境；标题里的原书三位号（5.1.9）原样保留。
2. 数学段先抽出占位，避免被 Markdown 粗体/转义规则破坏。
3. proof 结尾的手写 \\blacksquare 删掉——模版 proof 环境自动补空心方块。
4. HTML 注释行（<!--meta: ...-->）跳过，不能漏进 PDF。
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'html', 'content5.md')
# 版式基底：_base.tex（定理/定义/例题三条实色标题带，讲义版唯一版式）
BASE = os.path.join(HERE, '_base.tex')
OUT = os.path.join(HERE, '泛函分析讲义第五章.tex')

# ---------- 讲义信息 ----------
MAIN_TITLE = '泛函分析讲义'
SUB_TITLE = r'第五章\quad Banach 代数'
SOURCE = r'张恭庆、郭懋正《泛函分析讲义（第二版）》下册'
DATE = '二〇二六年十一月'
CHAPTER_PREFIX = '泛函分析讲义·'      # 章标题里去掉这个前缀

# 盒类型 → (LaTeX 环境, 中文名前缀)
BOX = {
    'def':     ('definition',  '定义'),
    'thm':     ('theorem',     '定理'),
    'lemma':   ('lemma',       '引理'),
    'prop':    ('proposition', '命题'),
    'cor':     ('corollary',   '推论'),
    'ex':      ('example',     '例题'),
    'rem':     ('remark',      '注'),
    'supp':    ('supplement',  '补证'),
    'explain': ('explanation', '解释'),
    'aside':   ('explanation', '解释'),
    'notice':  ('conclusion',  '结论'),
    'proof':   ('proof',       None),
}
# 这些类型的中文名不参与标题拆分（标题整串作 #3）
FREEFORM = {'explain', 'aside', 'notice', 'proof'}

PREFIXES = ['定理', '引理', '命题', '推论', '定义', '例题', '例', '补证', '注', '评注', '公理']


def split_title(raw, kind, cn):
    """把「定义 5.1.1（代数 / algebra）」拆成模版需要的 #3 部分。"""
    raw = raw.strip()
    if not raw:
        return ''
    if kind in FREEFORM:
        return raw
    for p in PREFIXES:
        if raw.startswith(p + ' '):
            return raw[len(p) + 1:].strip()
        if raw.startswith(p + '（'):
            return raw[len(p):].strip()
    return raw


def esc_text(s):
    """非数学文本的 LaTeX 转义。"""
    s = s.replace('\\', r'\textbackslash{}')
    for ch, rep in [('%', r'\%'), ('&', r'\&'), ('#', r'\#'),
                    ('_', r'\_'), ('$', r'\$')]:
        s = s.replace(ch, rep)
    return s


STASH = []


def stash(m):
    STASH.append(m.group(0))
    return '\x00%d\x00' % (len(STASH) - 1)


def restore(s):
    def back(m):
        return STASH[int(m.group(1))]
    return re.sub(r'\x00(\d+)\x00', back, s)


def inline_tex(line):
    """行内处理：抽数学、转粗体、转义、放回。"""
    STASH.clear()
    line = re.sub(r'\$\$.+?\$\$', stash, line)      # 单行 display
    line = re.sub(r'\$[^$]+?\$', stash, line)       # 行内
    line = esc_text(line)
    line = re.sub(r'\*\*(.+?)\*\*', lambda m: r'\textbf{' + m.group(1) + '}',
                  line)
    # @@文字@@ → 深蓝（AddColor）：正文里标出"后补的"内容，与原文黑字区分
    # 注意：explain/conclusion 夹注盒本身已是紫色，盒内仍用这个深蓝做行内标注
    line = re.sub(r'@@(.+?)@@',
                  lambda m: r'\textcolor{AddColor}{' + m.group(1) + '}', line)
    return restore(line)


def convert(md):
    lines = md.replace('\r\n', '\n').split('\n')
    out = []
    i = 0
    n = len(lines)
    stack = []          # 盒嵌套栈
    in_display = False
    disp = []
    in_list = False

    def close_list():
        nonlocal in_list
        if in_list:
            out.append(r'\end{itemize}')
            in_list = False

    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # ---------- HTML 注释 / 元信息，整行丢弃 ----------
        if stripped.startswith('<!--'):
            i += 1
            continue

        # ---------- 显示公式 ----------
        # 配对规则：只数 $$ 出现次数。有的公式以 `\end{aligned}$$` 收尾，
        # 不是单独的 $$ 行，按行首/行尾判断会配对失败、把后文全吞掉。
        if in_display:
            if '$$' in line:
                before = line.split('$$', 1)[0]
                if before.strip():
                    disp.append(before)
                out.append(render_display('\n'.join(disp)))
                disp = []
                in_display = False
                tail = line.split('$$', 1)[1]
                if tail.strip():
                    out.append(inline_tex(tail.strip()))
            else:
                disp.append(line)
            i += 1
            continue

        if '$$' in stripped:
            close_list()
            if stripped.count('$$') >= 2:
                inner = stripped.split('$$')[1]
                out.append(render_display(inner))
                tail = stripped.split('$$')[-1]
                if tail.strip():
                    out.append(inline_tex(tail.strip()))
            else:
                in_display = True
                after = stripped.split('$$', 1)[1]
                disp = [after] if after.strip() else []
            i += 1
            continue

        # ---------- 盒标记 ----------
        m = re.match(r'^(:{3,})\s*([A-Za-z]+)\s*(.*)$', stripped)
        if m:
            close_list()
            kind = m.group(2).lower()
            title = m.group(3).strip()
            if kind in BOX:
                env, cn = BOX[kind]
                arg = split_title(title, kind, cn)
                if kind == 'proof':
                    # md 的标题一律写成「X 的证明」，latex 前缀已含「证明」，
                    # 去掉后缀避免「证明（命题 5.1.5 的证明）」。
                    if arg.endswith('的证明'):
                        arg = arg[:-3].strip()
                    head = r'\begin{proof}' if not arg else \
                           r'\begin{proof}[' + inline_tex(arg) + ']'
                else:
                    head = r'\begin{' + env + '}'
                    if arg:
                        head += '[' + inline_tex(arg) + ']'
                stack.append((kind, env, head))
                out.append(head)
            else:
                stack.append((kind, None, ''))
            i += 1
            continue

        if re.match(r'^:{3,}\s*$', stripped):
            close_list()
            if stack:
                kind, env, head = stack.pop()
                if env:
                    out.append(r'\end{' + env + '}')
            i += 1
            continue

        # ---------- 标题 ----------
        m = re.match(r'^(#{1,3})\s+(.*)$', line)
        if m:
            close_list()
            level, text = len(m.group(1)), m.group(2).strip()
            if level == 1 and text.startswith(CHAPTER_PREFIX):
                text = text[len(CHAPTER_PREFIX):].strip()
            cmd = {1: 'chapter', 2: 'section', 3: 'subsection'}[level]
            out.append('\\' + cmd + '{' + inline_tex(text) + '}')
            i += 1
            continue

        # ---------- 列表 ----------
        if re.match(r'^\s*[-*]\s+', line):
            if not in_list:
                out.append(r'\begin{itemize}')
                in_list = True
            item = re.sub(r'^\s*[-*]\s+', '', line)
            out.append(r'  \item ' + inline_tex(item))
            i += 1
            continue

        if not stripped:
            close_list()
            out.append('')
            i += 1
            continue

        # ---------- 普通段落 ----------
        close_list()
        out.append(inline_tex(stripped))
        i += 1

    if stack:
        print('!! 未闭合的盒:', [x[0] for x in stack], file=sys.stderr)
    return '\n'.join(out)


def render_display(body):
    """显示公式：带 \\tag 的用 equation，其余用 \\[ \\]。

    所有公式都套 adjustbox 的 max width——它只缩不放，短公式完全不受影响，
    长公式则被压回页宽；否则过宽的公式会把 (5.2.2) 这类式号挤到下一行。
    equation 里的编号本身要占横向空间，所以留得更狠一点。
    """
    body = body.strip()
    if r'\tag{' in body:
        m = re.search(r'\\tag\{[^}]*\}', body)
        tag = m.group(0)
        inner = body.replace(tag, '').strip()
        return ('\\begin{equation}\n'
                r'\adjustbox{max width=0.86\linewidth}{$\displaystyle '
                + inner + '$}\n' + tag + '\n\\end{equation}')
    return ('\\[\n'
            r'\adjustbox{max width=0.96\linewidth}{$\displaystyle '
            + body + '$}\n\\]')


def build_preamble():
    text = io.open(BASE, encoding='utf-8').read()
    text = text.replace(r'\newcommand{\DocMainTitle}{泛函分析讲义}',
                        r'\newcommand{\DocMainTitle}{' + MAIN_TITLE + '}')
    text = text.replace(r'\newcommand{\DocSubTitle}{第五章\quad Banach 代数}',
                        r'\newcommand{\DocSubTitle}{' + SUB_TITLE + '}')
    text = text.replace(r'\newcommand{\DocSource}{张恭庆、郭懋正《泛函分析讲义（第二版）》下册}',
                        r'\newcommand{\DocSource}{' + SOURCE + '}')
    text = text.replace(r'\newcommand{\DocDate}{二〇二六年十一月}',
                        r'\newcommand{\DocDate}{' + DATE + '}')
    text = text.replace(r'\newcommand{\ShortTitle}{泛函分析讲义}',
                        r'\newcommand{\ShortTitle}{' + MAIN_TITLE + '}')
    text = text.replace(r'pdftitle={\DocMainTitle\ \DocSubTitle}',
                        r'pdftitle={\DocMainTitle}')
    return text


def normalize_addcolor(text):
    """把跨行、跨段的 @@...@@ 块拆成「一段一对 @@」+「display 单独着色」。

    inline_tex 逐行处理，@@ 只在同一行内闭合才生效；而正文里常把一整段
    甚至几段后补内容整体包起来。这里先按空行切段、段内换行压成空格
    （LaTeX 段落内换行等价于空格），再逐段包 @@；段内的 $$...$$ 单独
    提出来，用 {\\color{AddColor}...} 着色（display 里不能用 \\textcolor 包块）。
    """
    out, pos = [], 0
    for m in re.finditer(r'@@(.*?)@@', text, flags=re.S):
        out.append(text[pos:m.start()])
        inner = m.group(1)
        segs = []
        for para in re.split(r'\n\s*\n', inner):
            para = para.strip()
            if not para:
                continue
            buf = []
            for ch in re.split(r'(\$\$.*?\$\$)', para, flags=re.S):
                ch = ch.strip()
                if not ch:
                    continue
                if ch.startswith('$$'):
                    if buf:
                        segs.append('@@' + ' '.join(buf) + '@@')
                        buf = []
                    body = ch[2:-2].strip()
                    segs.append('$${\\color{AddColor}' + body + '}$$')
                else:
                    buf.append(' '.join(x.strip() for x in ch.splitlines() if x.strip()))
            if buf:
                segs.append('@@' + ' '.join(buf) + '@@')
        out.append('\n\n'.join(segs))
        pos = m.end()
    out.append(text[pos:])
    return ''.join(out)


def main():
    md = io.open(SRC, encoding='utf-8').read()
    md = normalize_addcolor(md)
    body = convert(md)
    tex = (build_preamble()
           + '\n\\begin{document}\n\n\\frontmatter\n\n'
           + '\\MakeTitlePage\n\n\\tableofcontents\n\n\\mainmatter\n\n'
           + body + '\n\n\\end{document}\n')
    # proof 结尾的手写方块去掉（模版 proof 环境自动补空心方块）；
    # 只删 proof 环境内的，supp 等非 proof 盒里的 $\\blacksquare$ 要保留
    tex = re.sub(r'\\begin\{proof\}.*?\\end\{proof\}',
                 lambda m: m.group(0).replace('$\\blacksquare$', ''),
                 tex, flags=re.S)
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(tex)
    print('OK:', os.path.basename(OUT), len(tex) // 1024, 'KB')
    print('  盒子:', len(re.findall(
        r'\\begin\{(theorem|lemma|proposition|corollary|definition|example|supplement|remark|explanation|conclusion|proof)\}', tex)))
    print('  公式:', len(re.findall(r'\\\[|\\begin\{equation\}', tex)))
    print('  section:', len(re.findall(r'\\section\{', tex)),
          ' subsection:', len(re.findall(r'\\subsection\{', tex)))


if __name__ == '__main__':
    main()
