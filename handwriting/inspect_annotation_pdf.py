# -*- coding: utf-8 -*-
"""手写批注 PDF 巡检与切片工具（讲义生成 skill · 手写版讲义转换）。

用途：拿到一份「打印出来写了字、再导出的 PDF」后，先判断它属于哪种输入形态，
再把页面按上下半页切成 300 dpi 图，供逐条读取手写内容。

用法：
    python inspect_annotation_pdf.py <pdf>                 # 只巡检，不出图
    python inspect_annotation_pdf.py <pdf> --render <dir>  # 巡检 + 切图
    python inspect_annotation_pdf.py <pdf> --render <dir> --page 3   # 只切第 3 页

判形依据：
    A 我们自己产出的讲义 PDF 上批注 —— 有完整文本层、drawings 多、颜色含 skill 的盒色
    B 原书扫描页上批注           —— 文本层几乎为空，页面主要是整页图片
    C 纸质书拍照                 —— 不是 PDF 或页面是大位图，成本最高

注意：手写笔迹是矢量 drawings，不是 annotations；page.get_text() 读到的是印刷体，
手写读不出来，必须渲染成图看。
"""
import argparse
import collections
import os
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit('需要 PyMuPDF：pip install pymupdf')

# skill 讲义版的盒色（仅作参考：Quartz 导出的 PDF 会把文字也转成路径，
# 印刷色与笔迹色可能重叠，最终仍以渲染图为准）
PRINT_COLORS = {
    (0.78, 0.31, 0.43), (0.85, 0.2, 0.4),      # 定理族玫红
    (0.78, 0.39, 0.12), (0.8, 0.4, 0.1),       # 定义橙
    (0.27, 0.51, 0.71), (0.19, 0.36, 0.69),    # 例题钢蓝
    (0.41, 0.35, 0.63), (0.42, 0.35, 0.63),    # 夹注紫
    (0.59, 0.41, 0.16), (0.15, 0.41, 0.16),    # 补证棕金
    (0.29, 0.35, 0.45), (0.0, 0.54, 0.5),      # 注石板蓝 / 结论青
}


def norm(c):
    """把 (r,g,b) 规范到 2 位小数，便于聚类。"""
    return tuple(round(float(x), 2) for x in c)


def is_colored(c):
    """排除近白填充（盒底、纸面），其余彩色路径都算候选。"""
    if c is None:
        return False
    if max(c) > 0.97 and min(c) > 0.90:
        return False
    return True


def inspect(doc):
    print('=== 文档 ===')
    print('页数:', doc.page_count)
    meta = doc.metadata or {}
    print('Producer:', meta.get('producer') or '(空)')
    print('Creator :', meta.get('creator') or '(空)')

    total_text = 0
    total_draw = 0
    ink_pages = 0
    print('\n=== 逐页 ===')
    print('%4s %8s %7s %6s %9s  %s' % ('页', '文本字符', 'drawings', '图片', '尺寸(pt)', '主要路径色'))
    for i in range(doc.page_count):
        pg = doc[i]
        text = pg.get_text()
        draw = pg.get_drawings()
        total_text += len(text.strip())
        total_draw += len(draw)
        counter = collections.Counter()
        for dr in draw:
            for key in ('color', 'fill'):
                c = dr.get(key)
                if c and is_colored(c):
                    counter[norm(c)] += 1
        inks = [c for c, _ in counter.most_common(3)]
        if inks:
            ink_pages += 1
        r = pg.rect
        print('%4d %8d %7d %6d %9s  %s' % (
            i + 1, len(text.strip()), len(draw), len(pg.get_images(full=True)),
            '%.0fx%.0f' % (r.width, r.height),
            ' '.join(str(c) for c in inks) if inks else '-'))

    print('\n=== 判形 ===')
    avg_text = total_text / max(doc.page_count, 1)
    avg_draw = total_draw / max(doc.page_count, 1)
    if avg_text < 200 and avg_draw < 50:
        print('B/C 类：文本层几乎为空、矢量路径很少 → 原书扫描页或照片')
        print('     先按 SKILL §1.6 走 OCR 成稿，再按 §7 插批注')
    elif avg_draw > 200 and ink_pages >= doc.page_count * 0.6:
        print('A 类：有完整文本层，且多数页面含大量彩色矢量路径 → 在讲义 PDF 上手写批注')
        print('     直接改 contentN.md，把批注按论证顺序插进去（SKILL §7.4）')
    else:
        print('混合型：部分页有笔迹，部分页是纯印刷体')
        print('     逐页判断；无笔迹的页可直接用作基准文本')
    print('平均每页 %d 字 / %d 条路径 / 含彩色路径页 %d' % (avg_text, avg_draw, ink_pages))
    print('注：颜色仅作参考——Quartz 导出会把文字也转成路径，笔迹请以渲图为准')


def render(doc, outdir, page_no=None):
    os.makedirs(outdir, exist_ok=True)
    pages = [page_no - 1] if page_no else range(doc.page_count)
    for i in pages:
        if i < 0 or i >= doc.page_count:
            print('跳过越界页', i + 1)
            continue
        pg = doc[i]
        r = pg.rect
        # 上下半页各留 25pt 重叠，避免跨半页的公式被切断
        for j, (y0, y1) in enumerate([(0, r.height / 2 + 25), (r.height / 2 - 25, r.height)]):
            clip = fitz.Rect(0, y0, r.width, y1)
            pix = pg.get_pixmap(dpi=300, clip=clip)
            f = os.path.join(outdir, 'p%02d_%d.png' % (i + 1, j + 1))
            pix.save(f)
            print('  写入', f, pix.width, 'x', pix.height)


def main():
    ap = argparse.ArgumentParser(description='手写批注 PDF 巡检与切片')
    ap.add_argument('pdf')
    ap.add_argument('--render', metavar='DIR', help='切图输出目录')
    ap.add_argument('--page', type=int, help='只处理某一页（从 1 开始）')
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        sys.exit('找不到文件：%s' % args.pdf)

    doc = fitz.open(args.pdf)
    inspect(doc)
    if args.render:
        print('\n=== 切图（上下半页，300 dpi）===')
        render(doc, args.render, args.page)
    doc.close()


if __name__ == '__main__':
    main()
