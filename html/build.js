/* build.js — 把 content md 编译成自包含、离线可开的 HTML 讲义
 *
 * 用法: node build.js <输出.html> [--theme=threecolor|solid] <源1.md> [源2.md ...]
 *       --theme 缺省 threecolor；不给源文件时默认读 content.md
 *
 * 两个主题共用：公式预渲染（KaTeX + 字体内嵌）、Markdown 块解析、盒解析、CLI。
 * 差异只在渲染层：
 *   threecolor  section.box + box-title/box-body，证明与白话都是独立盒（分色版）
 *   solid       div.thmbox + p.thm-title/span.tag，白话压成 p.explain，
 *               证明内联进首个段落（单色深蓝版）
 *
 * 依赖: katex（装在 node 隔离工作区）；style-threecolor.css / style-solid.css
 */
const fs = require('fs');
const path = require('path');

const KATEX_ROOT = process.env.KATEX_ROOT || require.resolve('katex');
const katex = require(KATEX_ROOT);

/* ---------------- 0. 参数 ---------------- */
const argv = process.argv.slice(2);
let theme = 'threecolor';
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--theme') { theme = argv[++i] || ''; continue; }
  if (a.startsWith('--theme=')) { theme = a.slice('--theme='.length); continue; }
  if (a === '-h' || a === '--help') {
    process.stderr.write('用法: node build.js <输出.html> [--theme=threecolor|solid] <源1.md> [...]\n');
    process.exit(0);
  }
  pos.push(a);
}
const OUT = pos[0];
const SRCS = pos.slice(1);
if (!OUT) {
  process.stderr.write('缺输出路径。用法: node build.js <输出.html> [--theme=threecolor|solid] <源1.md> [...]\n');
  process.exit(1);
}
if (!SRCS.length) SRCS.push('content.md');
if (!['threecolor', 'solid'].includes(theme)) {
  process.stderr.write('未知主题: ' + theme + '（只能是 threecolor 或 solid）\n');
  process.exit(1);
}

/* ---------------- 1. 公式预渲染 ---------------- */
const maths = [];
const PH_L = '\uE000', PH_R = '\uE001';
const stash = html => { maths.push(html); return PH_L + 'M' + (maths.length - 1) + PH_R; };

function renderTex(tex, display) {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display, throwOnError: true, strict: false, output: 'html'
    });
  } catch (e) {
    process.stderr.write('KATEX ERROR: ' + tex.trim().slice(0, 120) + '\n  ' + e.message + '\n');
    return '<span class="katex-err">' + tex.trim() + '</span>';
  }
}

let text = SRCS.map(f => fs.readFileSync(f, 'utf8')).join('\n\n').replace(/\r\n/g, '\n');

// 块级 $$...$$（先处理，避免被行内规则吃掉）
text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => stash(renderTex(tex, true)));
// 行内 $...$
text = text.replace(/\$([^$\n]+?)\$/g, (m, tex) => stash(renderTex(tex, false)));

/* 元信息注释（在公式 stash 之后剥离，故其中的 $...$ 已可正常渲染）
 * <!--meta: …-->      → 纯色版的 p.book-meta（紧跟 h1）
 * <!--tocsub: …-->    → 纯色版侧栏副标题；缺省不输出该行 */
let META = '', TOCSUB = '';
text = text.replace(/<!--\s*meta:\s*([\s\S]*?)-->/i, (m, s) => { META = s.trim(); return ''; });
text = text.replace(/<!--\s*tocsub:\s*([\s\S]*?)-->/i, (m, s) => { TOCSUB = s.trim(); return ''; });

/* ---------------- 2. 行内标记 ---------------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  s = s.replace(/\\\*/g, '\uE002');                 // 保护字面 *，避免被斜体规则吃掉
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(new RegExp(PH_L + 'M(\\d+)' + PH_R, 'g'), (m, n) => maths[+n]);
  return s.replace(/\uE002/g, '*');
}

/* ---------------- 3. Markdown 块解析 ---------------- */
function mdBlock(src, R) {
  const PTAG = R.pclass ? '<p class="' + R.pclass + '">' : '<p>';
  const lines = src.split('\n');
  const html = [];
  let lb = [], lt = null, olStart = 1;
  const flush = () => {
    if (!lb.length) return;
    const attr = (lt === 'ol' && olStart !== 1) ? ' start="' + olStart + '"' : '';
    html.push('<' + lt + attr + '>' + lb.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + lt + '>');
    lb = []; lt = null; olStart = 1;
  };
  const isRow = s => /^\s*\|.*\|\s*$/.test(s);
  const isSep = s => /^\s*\|[\s:|-]+\|\s*$/.test(s);
  const cells = s => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
  const MATH_ONLY = new RegExp('^' + PH_L + 'M\\d+' + PH_R + '$');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }
    let m;

    // 表格：连续以 | 开头且第二行是分隔行
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      flush();
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) { rows.push(cells(lines[i])); i++; }
      i--;
      html.push('<div class="tablewrap"><table><thead><tr>' +
        head.map(h => '<th>' + inline(h) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    // 独立成行的块级公式
    if (MATH_ONLY.test(line.trim())) {
      flush();
      html.push('<div class="mathblock">' +
        line.trim().replace(new RegExp(PH_L + 'M(\\d+)' + PH_R), (x, n) => maths[+n]) + '</div>');
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      html.push(R.heading(m[1].length, m[2]));
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flush(); html.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (lt !== 'ul') { flush(); lt = 'ul'; } lb.push(m[1]); continue; }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      if (lt !== 'ol') { flush(); lt = 'ol'; olStart = parseInt(m[1], 10); }
      lb.push(m[2]); continue;
    }
    flush();
    html.push(PTAG + inline(line) + '</p>');
  }
  flush();
  return html.join('\n');
}

/* ---------------- 4. 盒解析（产出 AST，供两套渲染器共用） ---------------- */
const TAG_3C = {
  def: '定义', thm: '定理', lemma: '引理', prop: '命题', cor: '推论',
  proof: '证明', sol: '解', ex: '例',
  notice: '注意', explain: '白话解读', aside: '旁注', hw: '作业', remark: '评注'
};
const TAG_SOLID = {
  def: ['定义', 'def'], thm: ['定理', 'thm'], prop: ['命题', 'prop'], lemma: ['引理', 'lem'],
  cor: ['推论', 'cor'], ex: ['例', 'ex'], remark: ['注', 'rem'], note: ['注', 'rem']
};
// 只有这些类型带三位号编号时才生成锚点（索引页按锚点跳转）
const ID_TYPES = { def: 1, thm: 1, lemma: 1, prop: 1, cor: 1, ex: 1 };

function parse(src) {
  const root = { t: 'root', type: 'root', title: '', colon: 0, items: [] };
  const stack = [root];
  const CLOSE = /^(:{3,})\s*$/;
  const OPEN = /^(:{3,})\s*([A-Za-z]+)\s*(.*)$/;

  for (const line of src.split('\n')) {
    let m;
    if ((m = line.match(CLOSE))) {
      // 只有与栈顶冒号数一致时才闭合；孤立结束标记忽略
      if (stack.length > 1 && m[1].length === stack[stack.length - 1].colon) {
        const b = stack.pop();
        stack[stack.length - 1].items.push(b);
      }
      continue;
    }
    if ((m = line.match(OPEN))) {
      stack.push({ t: 'box', type: m[2].toLowerCase(), title: m[3] || '', colon: m[1].length, items: [] });
      continue;
    }
    stack[stack.length - 1].items.push({ t: 'line', s: line });
  }
  while (stack.length > 1) {
    const b = stack.pop();
    stack[stack.length - 1].items.push(b);
  }
  return root;
}

// 未闭合的盒按栈序收尾（与原实现一致：从内到外补 push，故父盒后闭合）
const ast = parse(text);

/* ---------------- 5. 渲染器 ---------------- */

/* ---- 5a. threecolor ---- */
const R3 = {
  name: 'threecolor',
  pclass: '',
  toc: [],
  hid: 0,
  heading(lvl, txt) {
    const id = 'h' + lvl + '-' + (++this.hid);
    if (lvl === 2 || lvl === 3) this.toc.push({ lvl, id, html: inline(txt) });
    const tag = lvl === 1 ? 'h1' : (lvl === 2 ? 'h2' : (lvl === 3 ? 'h3' : 'h4'));
    return '<' + tag + ' id="' + id + '">' + inline(txt) + '</' + tag + '>';
  },
  box(b, body) {
    const tag = TAG_3C[b.type] || '注';
    const title = (b.title || '').trim();
    const NO_TAG = { explain: 1 };
    const showTag = !NO_TAG[b.type] && (title === '' || !title.includes(tag));
    const nm = ID_TYPES[b.type] ? title.match(/(\d+\.\d+\.\d+)([′']?)/) : null;
    const idAttr = nm ? ' id="' + b.type + '-' + nm[1] + (nm[2] ? 'p' : '') + '"' : '';
    const titleHtml = (showTag || title)
      ? '<div class="box-title">' +
        (showTag ? '<span class="box-tag">' + tag + '</span>' : '') +
        (title ? inline(title) : '') +
        '</div>'
      : '';
    return '<section class="box box-' + b.type + '"' + idAttr + '>' +
      titleHtml + '<div class="box-body">' + body + '</div></section>';
  },
  docTitle(t) { return t.replace(/[*$]/g, '').trim() || '讲义'; },
  tocHtml() {
    return this.toc.map(t => '<a class="toc-lv' + t.lvl + '" href="#' + t.id + '">' + t.html + '</a>').join('\n');
  },
  page(o) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.docTitle}</title>
<style>
${o.katexCss}
</style>
<style>
${o.pageCss}
</style>
</head>
<body>
<div class="wrap">
  <nav class="toc">
    <div class="toc-head">目录</div>
${o.tocHtml}
  </nav>
  <main class="doc">
${o.body}
  </main>
</div>
<script>
document.querySelectorAll('.toc a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const t = document.querySelector(a.getAttribute('href'));
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
</script>
</body>
</html>
`;
  }
};

/* ---- 5b. solid ---- */
const RS = {
  name: 'solid',
  pclass: 'body',
  toc: [],
  h2n: 0,
  heading(lvl, txt) {
    const t = txt.trim();
    if (lvl === 1) {
      this.toc.push({ lvl: 1, id: 'ch0', text: t });
      return '<h1 class="book-title" id="ch0">' + inline(t) + '</h1>';
    }
    if (lvl === 2) {
      this.h2n += 1;
      const id = 'sec' + this.h2n;
      this.toc.push({ lvl: 2, id, text: t });
      return '<h2 class="section" id="' + id + '">' + inline(t) + '</h2>';
    }
    if (lvl === 3) {
      const id = 'sec' + this.h2n + '-' + (this.toc.filter(h => h.lvl === 3 && h.parent === this.h2n).length + 1);
      this.toc.push({ lvl: 3, id, text: t, parent: this.h2n });
      return '<h3 class="subsection" id="' + id + '">' + inline(t) + '</h3>';
    }
    return '<h4>' + inline(t) + '</h4>';
  },
  box(b, inner) {
    const type = b.type;
    const title = (b.title || '').trim();

    // 白话/旁注/提示：压成一段灰色括号注，不占盒子
    if (type === 'explain' || type === 'aside' || type === 'notice') {
      const flat = inner.replace(/<\/?p[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const head = title ? '<strong>' + inline(title) + '：</strong> ' : '';
      return '<p class="explain">（' + head + flat + '）</p>';
    }

    // 证明：标题内联进首个段落
    if (type === 'proof') {
      const pt = title.replace(/的证明$/, '').trim();
      const head = pt ? '<em>证明（' + inline(pt) + '）。</em> ' : '<em>证明。</em> ';
      if (inner.includes('<p class="body">')) {
        return inner.replace('<p class="body">', '<p class="body">' + head);
      }
      // 首段不是正文（例如直接以 display 公式开头）：单独补一段，避免整段「证明」丢失
      return '<p class="body">' + head + '</p>\n' + inner;
    }

    const meta = TAG_SOLID[type] || TAG_SOLID.remark;
    const head = '<p class="thm-title"><span class="tag ' + meta[1] + '">' + meta[0] + '</span>' + inline(title) + '</p>';
    const panel = inner.replace(/<p class="body">/g, '<p>');
    const nm = title.match(/(\d+\.\d+\.\d+)([′']?)/);
    const idAttr = nm ? ' id="' + type + '-' + nm[1] + (nm[2] ? 'p' : '') + '"' : '';
    return '<div class="thmbox"' + idAttr + '>\n' + head + '\n' + panel + '\n</div>';
  },
  docTitle(t) { return inline(t); },
  tocHtml() {
    return this.toc.filter(h => h.lvl <= 3).map(h => {
      const cls = h.lvl === 1 ? 'lv1' : (h.lvl === 2 ? 'lv2' : 'lv3');
      return '  <a class="' + cls + '" href="#' + h.id + '">' + inline(h.text) + '</a>';
    }).join('\n');
  },
  page(o) {
    const h1 = (this.toc.find(h => h.lvl === 1) || { text: '讲义' }).text;
    const tocTitle = h1.replace('·', '<br>').replace(/^\s+/, '');
    const subLine = o.tocSub ? '\n  <p class="toc-sub">' + inline(o.tocSub) + '</p>' : '';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(h1)}</title>
<style>
${o.katexCss}
</style>
<style>
${o.pageCss}</style>
</head>
<body>

<nav id="toc">
  <p class="toc-title">${tocTitle} · 逐跳步补全</p>${subLine}
${o.tocHtml}
</nav>

<main>
${o.body}
</main>

</body>
</html>
`;
  }
};

const R = theme === 'solid' ? RS : R3;

/* ---------------- 5c. 遍历：识别标题、渲染盒（盒内递归） ---------------- */
function renderNodes(nodes, R) {
  const out = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const s = buf.join('\n');
    buf = [];
    // 不按内容裁剪：纯空行块也要 push 空串，join 后才是原版那个空行
    out.push(mdBlock(s, R));
  };
  for (const n of nodes) {
    if (n.t === 'line') { buf.push(n.s); continue; }
    if (n.t === 'box') {
      flush();
      out.push(R.box(n, renderNodes(n.items, R)));
    }
  }
  flush();
  return out.join('\n');
}

const bodyHtmlRaw = renderNodes(ast.items, R);

/* meta 紧跟 h1 之后（仅纯色版使用） */
let bodyHtml = bodyHtmlRaw;
if (theme === 'solid' && META) {
  bodyHtml = bodyHtml.replace(/<\/h1>/, '</h1>\n<p class="book-meta">' + inline(META) + '</p>');
}

/* ---------------- 6. KaTeX CSS 内联（字体转 base64） ---------------- */
let katexCss = fs.readFileSync(path.join(KATEX_ROOT, 'dist', 'katex.min.css'), 'utf8');
// 去掉 woff / ttf 备选源，只保留 woff2
katexCss = katexCss.replace(/,\s*url\(fonts\/[^)]+\.woff\)\s*format\("woff"\)/g, '');
katexCss = katexCss.replace(/,\s*url\(fonts\/[^)]+\.ttf\)\s*format\("truetype"\)/g, '');
katexCss = katexCss.replace(/url\(fonts\/([^)]+)\)/g, (m, file) => {
  const p = path.join(KATEX_ROOT, 'dist', 'fonts', file);
  return 'url(data:font/woff2;base64,' + fs.readFileSync(p).toString('base64') + ')';
});

/* ---------------- 7. 页面样式与组装 ---------------- */
const cssFile = theme === 'solid' ? 'style-solid.css' : 'style-threecolor.css';
const pageCss = fs.readFileSync(path.join(__dirname, cssFile), 'utf8');

const mH1 = text.match(/^#\s+(.*)$/m);
const html = R.page({
  docTitle: R.docTitle(mH1 ? mH1[1] : ''),
  katexCss,
  pageCss,
  tocSub: TOCSUB,
  tocHtml: R.tocHtml(),
  body: bodyHtml
});

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
process.stderr.write(
  'OK: ' + OUT + '  (' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB, ' +
  maths.length + ' formulas, theme=' + theme + ')\n'
);
