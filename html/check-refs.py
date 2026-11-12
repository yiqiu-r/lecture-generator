# -*- coding: utf-8 -*-
"""check-refs.py —— 公式交叉引用核对

用法：
    python check-refs.py content.md [content3.md ...]

检查两件事：
1. 跨节引用「§X.Y 的 (N)」中的 (N) 是否真在该节存在（目标节不在本文件时只提示，不报错）；
2. 同节「裸引用」（只写「由 (N)」「(N) 式」而不交代出处）是否落在本节编号范围内。

讲义正文引用别处的编号时必须写出处（「定理 2.56 的 (14) 式」「§2.3 的 (7)」），
否则读者在本节里找不到。已写明出处的引用不算裸引用。

权威版本在 skills/lecture-generator/scripts/check-refs.py；assets/threecolor、
assets/solid、assets/pdf-lecture 各有一份内容完全相同的副本（随 assets 拷进项目即可用）。
改动时四处同步。
"""
import re
import sys
from collections import defaultdict


def emit(msg):
    sys.stdout.write(msg + '\n')


def load(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    sec_of_line, cur = [], None
    for ln in lines:
        m = re.match(r'^##\s+§([0-9]+\.[0-9]+)', ln)
        if m:
            cur = m.group(1)
        sec_of_line.append(cur)
    return lines, sec_of_line


def numbers(lines, sec_of_line):
    nums = defaultdict(set)
    for i, ln in enumerate(lines):
        s = sec_of_line[i]
        if s is None:
            continue
        for m in re.finditer(r'\\qquad\((\d+)\)', ln):
            nums[s].add(int(m.group(1)))
        for m in re.finditer(r'\((\d+)\)\s*\$\$\s*$', ln):
            nums[s].add(int(m.group(1)))
    return nums


# §2.3 的 (7)、§2.3 的 (43)、(52)、(53) 这类（含连续列举）
CROSS = re.compile(r'§([0-9]+\.[0-9]+)\s*的\s*((?:\([0-9]+\)\s*(?:[、，,与和及]\s*)?)+)')
SAME = re.compile(r'(?:由|代入|利用|见|即|按|与|及|和)\s*\((\d+)\)')
SUFFIX = re.compile(r'\((\d+)\)\s*式')
# 出处在前面交代过：定理/引理/推论/例/性质/定义 + 编号 + 的；或「……证明中」
ANCHOR = re.compile(r'(?:定理|引理|推论|命题|例|性质|定义)\s*[0-9.]*[0-9a-zA-Z()]*\s*(?:性质\s*\([0-9]+\)\s*)?(?:证明中|的)\s*$')
ANCHOR_WINDOW = 60


def anchored(text, pos):
    return ANCHOR.search(text[max(0, pos - ANCHOR_WINDOW):pos]) is not None


def check(path):
    lines, sec_of_line = load(path)
    nums = numbers(lines, sec_of_line)
    if not nums:
        emit(f'  {path}: 未发现编号公式，跳过')
        return 0
    emit(f'== {path} ==')
    emit('  编号范围：' + '，'.join(
        f'§{s} 1–{max(nums[s])}' for s in sorted(nums, key=lambda x: tuple(map(int, x.split('.'))))))

    bad = 0
    for i, ln in enumerate(lines, 1):
        s = sec_of_line[i - 1]
        if s is None:
            continue

        masked = ln
        for m in CROSS.finditer(ln):
            tgt = m.group(1)
            ns = [int(x) for x in re.findall(r'\((\d+)\)', m.group(2))]
            for n in ns:
                if tgt not in nums:
                    emit(f'  · L{i} 引用 §{tgt} 的 ({n})：该节不在本文件，未校验')
                elif n not in nums[tgt]:
                    emit(f'  ! L{i} 引用 §{tgt} 的 ({n})，但 §{tgt} 只有 1–{max(nums[tgt])}')
                    bad += 1
            masked = masked.replace(m.group(0), '@' * 24)

        if '\\qquad(' in masked:
            continue
        for rx in (SAME, SUFFIX):
            for m in rx.finditer(masked):
                n = int(m.group(1))
                if n <= max(nums[s]) or anchored(ln, ln.find(m.group(0))):
                    continue
                head = masked[max(0, m.start() - 24):m.end() + 4]
                emit(f'  ! L{i} [{head.strip()}] —— 本节只到 ({max(nums[s])})，须写明出处')
                bad += 1
    if bad == 0:
        emit('  引用检查通过')
    return bad


def main():
    total = 0
    for p in sys.argv[1:]:
        total += check(p)
    emit(f'\n合计 {total} 处可疑引用。')
    return 0 if total == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
