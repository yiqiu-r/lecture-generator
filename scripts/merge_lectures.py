#!/usr/bin/env python3
# merge_lectures.py —— 把多份「Kuo 格式」HTML 讲义合并为一个自包含单文件 src。
#
# 用法：
#   python merge_lectures.py config.json
#
# 特性：
#   * 逐篇抽取 <nav id="toc"> 与 <main>，给所有 id/href 加篇前缀，避免跨篇锚点冲突
#   * 自动补标题锚点（<h1 class="book-title"> 无 id 时注入 id="<pfx>-top"）
#   * 自动修回顶链接（#<pfx>-toc 等失效目标统一改指 #<pfx>-top）
#   * 自动把各篇目录降级（源 lv1→总目录 lv2、lv2→lv3）挂在篇标题（lv1）之下
#   * 补回 <!DOCTYPE html> / <html lang>（只抽 <head> 会丢掉它们）
#
# 之后用 build_notes.js 渲染：
#   node build_notes.js <out> <final.html>
import json, os, re, sys

LVMAP = {'lv1': 'lv2', 'lv2': 'lv3', 'lv3': 'lv3'}

DEFAULT_EXTRA_CSS = '''
p.meta { color: #6a7689; font-size: 14px; margin: 0 0 22px; font-family: "Microsoft YaHei", sans-serif; }
h1.book-title { margin-top: 0; }
hr.sep { margin: 72px 0 0; border: none; border-top: 3px double var(--border); }
.card { background: #fff; border: 1px solid var(--border); border-left: 5px solid var(--accent);
        border-radius: 8px; padding: 14px 20px; margin: 16px 0; }
.card h3 { margin: 0 0 4px; font-size: 19px; font-family: "Microsoft YaHei", sans-serif; }
.card h3 a { color: var(--main-blue); text-decoration: none; }
.card h3 a:hover { text-decoration: underline; }
.card .sub { color: #6a7689; font-size: 13.5px; font-family: "Microsoft YaHei", sans-serif; margin: 0 0 8px; }
.card p { margin: 6px 0; color: var(--main-blue); }
.card .tags { font-family: "Microsoft YaHei", sans-serif; font-size: 13px; color: #4a5870; margin-top: 8px; }
.card .tags span { display: inline-block; background: #e3ebf6; border-radius: 4px; padding: 1px 8px; margin: 2px 6px 2px 0; }
.note { background: var(--panel-bg); border: 1px solid var(--border); border-left: 5px solid #8a6d3b;
        border-radius: 8px; padding: 14px 20px; margin: 16px 0; }
.note p { margin: 6px 0; color: var(--main-blue); }
'''


def prefix_anchors(s, pfx):
    """给片段内所有 id / href 加篇前缀。"""
    s = re.sub(r'id="([^"]+)"', lambda m: 'id="%s-%s"' % (pfx, m.group(1)), s)
    s = re.sub(r'href="#([^"]+)"', lambda m: 'href="#%s-%s"' % (pfx, m.group(1)), s)
    return s


def main():
    if len(sys.argv) < 2:
        print('用法: python merge_lectures.py config.json')
        return 1
    cfg_path = sys.argv[1]
    base = os.path.dirname(os.path.abspath(cfg_path))
    cfg = json.load(open(cfg_path, encoding='utf-8'))

    def resolve(p):
        return p if os.path.isabs(p) else os.path.join(base, p)

    def read(p):
        return open(resolve(p), encoding='utf-8').read()

    # ---- 1. 页头 ----
    head = re.search(r'<head>[\s\S]*?</head>', read(cfg['head_from'])).group(0)
    if cfg.get('title'):
        head = re.sub(r'<title>[\s\S]*?</title>',
                      '<title>%s</title>' % cfg['title'], head, count=1)
    default_css = cfg.get('extra_css', DEFAULT_EXTRA_CSS)
    if default_css and '</style>' in head:
        head = head.replace('</style>', default_css + '</style>')

    # ---- 2. 逐篇抽取与加工 ----
    papers = []
    for p in cfg['papers']:
        html = read(p['src'])
        pfx = p['pfx']
        nav = re.search(r'<nav id="toc">([\s\S]*?)</nav>', html)
        main_m = re.search(r'<main>([\s\S]*?)</main>', html)
        if not nav or not main_m:
            print('!! %s 缺少 <nav id="toc"> 或 <main>' % p['src'], file=sys.stderr)
            return 2
        nav = prefix_anchors(nav.group(1), pfx)
        main = prefix_anchors(main_m.group(1), pfx)

        # (a) 补标题锚点
        m = re.search(r'<h1 class="book-title"([^>]*)>', main)
        if m and 'id="' not in m.group(1):
            main = main[:m.start()] + '<h1 class="book-title" id="%s-top">' % pfx + main[m.end():]
        # (b) 回顶链接统一指向本讲义开头
        main = main.replace('href="#%s-toc"' % pfx, 'href="#%s-top"' % pfx)
        main = main.replace(cfg.get('backtop_from', '↑ 返回目录'),
                            cfg.get('backtop_to', '↑ 回到本讲义开头'))
        # (c) 目录条目
        links = re.findall(r'<a class="(lv\d)" href="([^"]+)">([\s\S]*?)</a>', nav)
        papers.append({'pfx': pfx, 'label': p['label'], 'main': main, 'links': links})

    # ---- 3. 组装 ----
    out = ['<!DOCTYPE html>\n<html lang="%s">' % cfg.get('lang', 'zh-CN'), head,
           '\n<body>\n\n<nav id="toc">']
    out.append('  <p class="toc-title">%s</p>' % cfg.get('toc_title', '讲义合集'))
    out.append('  <p class="toc-sub">%s</p>' % cfg.get('toc_sub', ''))
    for e in cfg.get('index_toc', []):
        out.append('  <a class="%s" href="#%s">%s</a>' % (e.get('lv', 'lv2'), e['href'], e['text']))
    for p in papers:
        out.append('  <a class="lv1" href="#%s-top">%s</a>' % (p['pfx'], p['label']))
        for cls, href, txt in p['links']:
            out.append('  <a class="%s" href="%s">%s</a>' % (LVMAP[cls], href, txt.strip()))
    out.append('</nav>\n')
    out.append('<main>')
    if cfg.get('index'):
        out.append(read(cfg['index']))
    for k, p in enumerate(papers):
        if k > 0:
            out.append('<hr class="sep">')
        out.append(p['main'])
    out.append('</main>\n\n</body>\n</html>')

    open(resolve(cfg['out']), 'w', encoding='utf-8').write('\n'.join(out))

    # ---- 4. 报告 ----
    print('输出', cfg['out'])
    for p in papers:
        print('  %s  %s  目录项 %2d' % (p['pfx'], p['label'][:40], len(p['links'])))
    print('正文目录项合计:', sum(len(p['links']) for p in papers))
    return 0


if __name__ == '__main__':
    sys.exit(main())
