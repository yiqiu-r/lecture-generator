/* build_index.js — 讲义「定理·定义总索引」生成器（版式无关模块）
 *
 * 从 content*.md 抽取带编号的盒子，生成一份可搜索的全量索引页：
 *   header（标题 + 统计胶囊）
 *   searchbox（实时搜索 / 回车跳首条 / 点外关闭 / 20 条上限 / 64 字截断）
 *   nav.toc（章级 <details> 折叠，节号 + 逐条胶囊链接）
 *   section.chapter > div.sec > div.item（badge + 原书页码 + 完整陈述）
 *   div.cond（(1)(2)(3) 悬挂缩进）、div.eq > span.eqb + span.eqno（公式 + 原书式号）
 *   .item:target 跳转高亮
 *
 * 公式由 mathjax-full 预渲染为 CHTML，字体以 base64 内嵌 → 离线自足，打开即完整。
 * 不依赖任何具体版式的 CSS：三色版、纯色版共用。
 *
 * 用法:
 *   node build_index.js                       # 读当前目录 index.config.json
 *   node build_index.js --config my.json
 *   node build_index.js --src ../html --out ../../../成品/x/索引.html
 */
const fs = require('fs');
const path = require('path');

/* mathjax-full 装在 node 隔离工作区；换机若报 MODULE_NOT_FOUND，改这一行即可 */
const MJROOT = (process.env.MATHJAX_ROOT || require.resolve('mathjax-full/js/mathjax.js').replace(/[\\/]+js[\\/]+mathjax\.js$/, '')) + '/js/';
const { mathjax } = require(MJROOT + 'mathjax.js');
const { TeX } = require(MJROOT + 'input/tex.js');
const { CHTML } = require(MJROOT + 'output/chtml.js');
const { liteAdaptor } = require(MJROOT + 'adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require(MJROOT + 'handlers/html.js');
const { AllPackages } = require(MJROOT + 'input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages, inlineMath: [['$', '$']], displayMath: [['$$', '$$']] });
const chtml = new CHTML({ fontURL: '' });
const mjdoc = mathjax.document('', { InputJax: tex, OutputJax: chtml });

/* ---------------- 参数与配置 ---------------- */
function argOf(name) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : '';
}

const DEFAULT_CONFIG = {
  title: '定理 · 定义 总索引',
  header: {
    h1: '定理 · 定义 · 引理 · 推论 总索引',
    sub: '',
    searchPlaceholder: '输入关键词搜索，如：Banach、谱半径、5.2.7（回车跳第一个结果）',
  },
  footer: '中文陈述按原书完整内容译出；公式由 MathJax 预渲染为 CHTML，字体已内嵌，无需联网。',
  sourceDir: '.',
  out: 'index.html',
  pages: {},        // { '5.1': 'p.1–6' }  留空则不显示原书页码、不自检
  enChapter: {},    // { '五': 'Banach Algebras' }
  enSection: {},    // { '5.1': 'Algebraic Preliminaries' }
  chapterFiles: {}, // { '五': '讲义·第五章.html' }  配了则目录胶囊直达正文
  pendingChapters: [], // 还没写成讲义的原书章（只上架目录骨架）：[{cn,cname,page,status,sections:[{num,name,page,subs}]}]
  pendingSections: {}, // 已写章节里缺的小节：{ '五': [{num,name,page,status}] }
  types: ['def', 'thm', 'prop', 'lemma', 'cor', 'ex', 'remark'], // 收进索引的盒类型
};

const cfgPath = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : (argOf('--config') ? path.resolve(argOf('--config')) : '');

let CFG = { ...DEFAULT_CONFIG };
let CFG_DIR = process.cwd();
if (cfgPath && fs.existsSync(cfgPath)) {
  CFG_DIR = path.dirname(cfgPath);
  const user = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  CFG = { ...CFG, ...user, header: { ...CFG.header, ...(user.header || {}) } };
} else if (cfgPath) {
  console.error('找不到配置文件：' + cfgPath);
  process.exit(1);
} else if (fs.existsSync(path.join(CFG_DIR, 'index.config.json'))) {
  const user = JSON.parse(fs.readFileSync(path.join(CFG_DIR, 'index.config.json'), 'utf8'));
  CFG = { ...CFG, ...user, header: { ...CFG.header, ...(user.header || {}) } };
}

const SRC_DIR = argOf('--src') ? path.resolve(argOf('--src')) : path.resolve(CFG_DIR, CFG.sourceDir);
const OUT = argOf('--out') ? path.resolve(argOf('--out')) : path.resolve(CFG_DIR, CFG.out);
const PAGE = CFG.pages || {};
const EN_CH = CFG.enChapter || {};
const EN_SEC = CFG.enSection || {};
const CHAPTER_FILES = CFG.chapterFiles || {};
const PEND_CH = CFG.pendingChapters || [];
const PEND_SEC = CFG.pendingSections || {};

/* ---------- 数学预渲染（带缓存） ---------- */
const mcache = new Map();
function mj(texSrc) {
  const key = texSrc.trim();
  if (mcache.has(key)) return mcache.get(key);
  let html;
  try {
    html = adaptor.outerHTML(mjdoc.convert(key, { display: false }));
  } catch (e) {
    html = '<span style="color:#c00">[公式错误]</span>';
  }
  mcache.set(key, html);
  return html;
}

/* ---------- 类型表 ---------- */
const TAGS = {
  def:    ['定义', 'def'],
  thm:    ['定理', 'thm'],
  prop:   ['命题', 'pro'],
  lemma:  ['引理', 'lem'],
  cor:    ['推论', 'cor'],
  ex:     ['例',   'ex'],
  remark: ['注',   'rem'],
  note:   ['注',   'rem'],
};
const WANT = new Set(CFG.types.map(t => t.toLowerCase()));
const ORDER = CFG.types.map(t => t.toLowerCase());
for (const k of Object.keys(TAGS)) if (!ORDER.includes(k)) ORDER.push(k);

/* ---------- 章号：中文 / 阿拉伯都认 ---------- */
const CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function cnToNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^[零〇一二三四五六七八九]$/.test(s)) return CN_DIGIT[s];
  if (/^十[零〇一二三四五六七八九]?$/.test(s)) return 10 + (s[1] ? CN_DIGIT[s[1]] : 0);
  if (/^[一二三四五六七八九]十[零〇一二三四五六七八九]?$/.test(s)) return CN_DIGIT[s[0]] * 10 + (s[2] ? CN_DIGIT[s[2]] : 0);
  return 0;
}

/* ---------- 文本工具 ---------- */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 行内：**粗** / *斜* / $数学$ */
function inline(s) {
  const maths = [];
  let t = s.replace(/\$([^$\n]+?)\$/g, (m, g) => {
    maths.push(g);
    return '\uE000' + (maths.length - 1) + '\uE001';
  });
  t = t.replace(/\\\*/g, '\uE002');
  t = esc(t);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\uE000(\d+)\uE001/g, (m, n) => mj(maths[+n]));
  return t.replace(/\uE002/g, '*');
}

/* 纯文本（供搜索用）：CHTML 的字符是伪元素，textContent 取不到，需另存一份 */
function plainText(mdText) {
  const SYM = { '\\in': '∈', '\\notin': '∉', '\\le': '≤', '\\leq': '≤', '\\ge': '≥', '\\geq': '≥',
                '\\to': '→', '\\ne': '≠', '\\neq': '≠', '\\subset': '⊂', '\\supset': '⊃',
                '\\times': '×', '\\cdot': '·', '\\infty': '∞', '\\mapsto': '↦', '\\cong': '≅' };
  return mdText
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$\n]+?)\$/g, (m, g) => {
      let t = g;
      for (const k in SYM) t = t.split(k).join(SYM[k]);
      return ' ' + t.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_\\]/g, ' ') + ' ';
    })
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}*`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

/* 两个片段拼接：ASCII 字母数字相邻时补空格，中文直接相连 */
function joinLines(lines) {
  let out = '';
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    if (out && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(s)) out += ' ';
    out += s;
  }
  return out;
}

/* ---------- 盒子正文 → HTML ---------- */
/* 规则：
 *   $$...$$            → div.eq（span.eqb + 可选 span.eqno）
 *   行首 (1)/(i)       → div.cond（cno 悬挂 + ctxt）
 *   其余行             → p
 *   - 项目             → ul
 */
function renderBody(text) {
  const src = text.replace(/\r\n/g, '\n');

  /* 1. 抽出 $$ 块，留占位 */
  const eqs = [];
  const EQ = '\uE100', EQE = '\uE101';
  let s = src.replace(/\$\$([\s\S]*?)\$\$/g, (m, body) => {
    let texSrc = body.trim();
    let tag = '';
    const tm = texSrc.match(/\\tag\{([^}]*)\}\s*$/);
    if (tm) {
      tag = tm[1].trim();
      texSrc = texSrc.replace(/\\tag\{[^}]*\}\s*$/, '').trim();
    }
    eqs.push({ tex: texSrc, tag });
    return EQ + (eqs.length - 1) + EQE;
  });

  /* 2. 按空行切块 */
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const out = [];

  const eqHTML = (i) => {
    const e = eqs[i];
    let h = '<div class="eq"><span class="eqb">' + mj(e.tex) + '</span>';
    if (e.tag) h += '<span class="eqno">（原书式 (' + esc(e.tag) + ')）</span>';
    return h + '</div>';
  };
  const isEqLine = (l) => new RegExp('^' + EQ + '\\d+' + EQE + '$').test(l.trim());

  for (const blk of blocks) {
    const lines = blk.split('\n');

    /* 纯公式块 */
    if (lines.length === 1 && isEqLine(lines[0])) {
      out.push(eqHTML(+lines[0].trim().slice(1, -1)));
      continue;
    }

    /* 项目列表 */
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) {
      out.push('<ul>' + lines.map(l => '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>').join('') + '</ul>');
      continue;
    }

    /* 混合块：逐行分派 */
    let pbuf = [];      // 普通段落缓冲
    let cond = null;    // 当前条件
    const flushP = () => {
      if (pbuf.length) { out.push('<p>' + inline(joinLines(pbuf)) + '</p>'); pbuf = []; }
    };
    const flushCond = () => {
      if (cond) {
        const inner = cond.parts.filter(x => x).map(x =>
          x.eq !== undefined ? eqHTML(x.eq) : '<p class="cp">' + inline(joinLines(x.lines)) + '</p>'
        ).join('');
        out.push('<div class="cond"><span class="cno">' + cond.no + '</span><div class="ctxt">' + inner + '</div></div>');
        cond = null;
      }
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (isEqLine(line)) {
        const i = +line.slice(1, -1);
        if (cond) cond.parts.push({ eq: i });
        else { flushP(); out.push(eqHTML(i)); }
        continue;
      }

      const m = line.match(/^[（(]([0-9]{1,2}|[ivx]{1,4})[）)]\s*(.*)$/);
      if (m) {
        flushCond();
        flushP();
        cond = { no: '(' + m[1] + ')', parts: [{ lines: [m[2]] }] };
        continue;
      }

      if (cond) {
        /* 「则 / 故 / 于是…」开头视为条件列表结束，回到正文 */
        if (/^(则|故|于是|因此|因而|由此|从而|总之|这就|其中|这里)/.test(line)) {
          flushCond();
          pbuf.push(line);
        } else {
          cond.parts.push({ lines: [line] });
        }
        continue;
      }

      pbuf.push(line);
    }
    flushCond();
    flushP();
  }
  return out.join('\n');
}

/* ---------- 解析 md ---------- */
function collect(mdText) {
  const lines = mdText.replace(/\r\n/g, '\n').split('\n');
  let h1 = '', sec = '', secNum = '';
  const boxes = [];
  let cur = null;
  for (const line of lines) {
    const open = line.match(/^(:{3,})\s*([A-Za-z]+)\s*(.*)$/);
    const close = line.match(/^(:{3,})\s*$/);
    if (open && !cur) {
      cur = { c: open[1].length, type: open[2].toLowerCase(), title: open[3].trim(), body: [], sec, secNum };
      continue;
    }
    if (close && cur && close[1].length === cur.c) { boxes.push(cur); cur = null; continue; }
    if (cur) { cur.body.push(line); continue; }
    if (/^# /.test(line) && !h1) { h1 = line.slice(2).trim(); continue; }
    if (/^## /.test(line)) {
      sec = line.slice(3).trim();
      secNum = (sec.match(/^§?(\d+\.\d+)/) || [])[1] || '';
      continue;
    }
  }
  return { h1, boxes };
}

/* ---------- 主流程 ---------- */
const files = fs.readdirSync(SRC_DIR).filter(f => /^content\d*\.md$/.test(f)).sort();
if (!files.length) {
  console.error('源目录里没有 content*.md：' + SRC_DIR);
  process.exit(1);
}
const chapters = [];
let seq = 0;

for (const f of files) {
  const raw = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  const { h1, boxes } = collect(raw);
  if (!h1) continue;
  seq += 1;
  const m = h1.match(/第\s*([一二三四五六七八九十百零〇\d]+)\s*章\s*(.*)$/);
  const cn = m ? m[1] : String(seq);
  const cname = m ? m[2].trim() : h1;
  const file = CHAPTER_FILES[cn] || CHAPTER_FILES[String(cnToNum(cn) || seq)] || '';
  const items = boxes
    .filter(b => WANT.has(b.type) && TAGS[b.type] && /(\d+\.\d+\.\d+)/.test(b.title))
    .map(b => {
      const nm = b.title.match(/(\d+\.\d+\.\d+)([′']?)/);
      const num = nm[1] + (nm[2] ? "'" : '');
      const paren = b.title.match(/[（(]([^（）()]{2,80})[）)]/);
      const kw = nm[1] + ' ' + (paren ? paren[1] : '') + ' ' + plainText(b.body.join('\n'));
      return {
        type: b.type, num, cn: TAGS[b.type][0], cls: TAGS[b.type][1],
        id: b.type + '-' + nm[1] + (nm[2] ? 'p' : ''),
        sec: b.sec, secNum: b.secNum,
        kw: kw.replace(/\s+/g, ' ').trim(),
        html: renderBody(b.body.join('\n')),
      };
    });
  chapters.push({ h1, cn, cname, cnum: cnToNum(cn) || seq, items, file });
}

chapters.sort((a, b) => a.cnum - b.cnum);

/* ---------- 统计 ---------- */
const cnt = {};
for (const c of chapters) for (const it of c.items) cnt[it.type] = (cnt[it.type] || 0) + 1;
const total = chapters.reduce((n, c) => n + c.items.length, 0);
const stat = ORDER.filter(k => cnt[k])
  .map(k => '<span>' + TAGS[k][0] + ' ' + cnt[k] + '</span>').join('');
const pendChN = PEND_CH.length;
const pendSecN = Object.keys(PEND_SEC).reduce((n, k) => n + (PEND_SEC[k] || []).length, 0);
const pendStat = (pendSecN ? '<span>未收录 ' + pendSecN + ' 节</span>' : '');

/* 待写小节（只有原书目录，没有条目）的公共渲染 */
function pendSecHtml(s, status) {
  const kw = (s.num + ' ' + s.name + ' ' + (s.subs || []).join(' ')).replace(/\s+/g, ' ').trim();
  let h = '<div class="sec pendsec" id="sec-' + s.num + '" data-num="§' + s.num +
          '" data-kw="' + esc(kw).replace(/"/g, '&quot;') + '">';
  h += '<h3>§' + esc(s.num) + '\u3000' + inline(s.name) +
       (EN_SEC[s.num] ? '<span class="en">' + esc(EN_SEC[s.num]) + '</span>' : '') +
       '<span class="pno">原书 ' + esc(s.page || '') +
       (status ? '　·　' + esc(status) : '') + '</span></h3>';
  if (s.note) h += '<div class="pnote">' + esc(s.note) + '</div>';
  if ((s.subs || []).length) {
    h += '<ul class="subs">' + s.subs.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  }
  return h + '</div>';
}

/* 目录胶囊的目标：配了 chapterFiles 就直达正文，否则页内锚点 */
const targetOf = (c, it) => c.file ? esc(c.file) + '#' + it.id : '#' + it.id;

/* ---------- 目录（章级折叠） ---------- */
const toc = [];
for (const c of chapters) {
  toc.push('<details class="tocch"><summary>Ch' + c.cnum + ' ' + esc(c.cname) + '（' + c.items.length + ' 条）</summary>');
  let lastSec = null;
  for (const it of c.items) {
    if (it.sec !== lastSec) {
      toc.push('<div class="tocsec">' + inline(it.sec) + '</div>');
      lastSec = it.sec;
    }
    toc.push('<a class="tocitem" href="' + targetOf(c, it) + '">' + it.cn + ' ' + it.num + '</a>');
  }
  for (const s of (PEND_SEC[c.cn] || [])) {
    toc.push('<div class="tocsec">§' + esc(s.num) + '\u3000' + esc(s.name) + '</div>');
    toc.push('<a class="tocitem pend" href="#sec-' + s.num + '">§' + esc(s.num) + '（待补）</a>');
  }
  toc.push('</details>');
}
for (const c of PEND_CH) {
  toc.push('<details class="tocch pending"><summary>Ch' + (cnToNum(c.cn) || '') + ' ' + esc(c.cname) +
           '</summary>');
  for (const s of (c.sections || [])) {
    toc.push('<a class="tocitem pend" href="#sec-' + s.num + '">§' + esc(s.num) + ' ' + esc(s.name) + '</a>');
  }
  toc.push('</details>');
}

/* ---------- 正文 ---------- */
const body = [];
for (const c of chapters) {
  body.push('<section class="chapter" id="ch' + c.cnum + '"><h2>Ch' + c.cnum + ' ' + esc(c.cname) +
            ' <span style="opacity:.65;font-weight:400;font-size:15px">' + esc(EN_CH[c.cn] || '') + '</span></h2>');
  const secs = new Map();
  for (const it of c.items) {
    const k = it.secNum || it.sec;
    if (!secs.has(k)) secs.set(k, { name: it.sec, items: [] });
    secs.get(k).items.push(it);
  }
  for (const [k, g] of secs) {
    const secName = g.name.replace(/^§?\d+\.\d+\s*/, '').trim();
    const en = EN_SEC[k] ? ' ' + EN_SEC[k] : '';
    body.push('<div class="sec"><h3>' + esc(k) + '\u3000' + inline(secName) + '<span class="en">' + esc(en.trim()) + '</span></h3>');
    for (const it of g.items) {
      const page = PAGE[it.secNum] || '';
      const jump = c.file
        ? '<a class="jump" href="' + esc(c.file) + '#' + it.id + '" title="在正文章节中查看">正文 ↗</a>'
        : '';
      body.push(
        '<div class="item ' + it.cls + '" id="' + it.id + '" data-kw="' + esc(it.kw).replace(/"/g, '&quot;') + '">' +
        '<div class="item-head"><span class="badge ' + it.cls + '">' + it.cn + ' ' + it.num + '</span>' +
        '<span class="pno">' + (page ? '原书 ' + page : '') + jump + '</span></div>' +
        '<div class="stmt">' + it.html + '</div></div>'
      );
    }
    body.push('</div>');
  }
  for (const s of (PEND_SEC[c.cn] || [])) body.push(pendSecHtml(s, s.status));
  body.push('</section>');
}
/* 还没写成讲义的章：只上架原书目录骨架，指向原书页码 */
for (const c of PEND_CH) {
  body.push('<section class="chapter pending" id="ch' + (cnToNum(c.cn) || c.cn) + '"><h2>Ch' +
            (cnToNum(c.cn) || c.cn) + ' ' + esc(c.cname) +
            ' <span style="opacity:.65;font-weight:400;font-size:15px">' + esc(EN_CH[c.cn] || '') + '</span>' +
            ' <span class="pno">原书 ' + esc(c.page || '') + '</span></h2>');
  for (const s of (c.sections || [])) body.push(pendSecHtml(s, ''));
  body.push('</section>');
}

/* ---------- 组装 ---------- */
const pageCss = fs.readFileSync(path.join(__dirname, 'style_index_page.css'), 'utf8');
const fontsCss = fs.readFileSync(path.join(__dirname, 'mathjax_fonts.css'), 'utf8');

/* 引擎样式表：此刻已渲染完全部公式，包含所有用到的字符规则；剥掉它自带的 @font-face（会覆盖内嵌字体） */
let engineCss = adaptor.textContent(chtml.styleSheet(mjdoc));
engineCss = engineCss.replace(/@font-face[\s\S]*?\n\}\n/g, '');

const LOCAL_CSS = `
/* 例子盒 / 注（原模板只有 def/thm/lem/cor/pro 五种） */
.item.ex{border-left-color:#7a6a9e}
.badge.ex{background:#7a6a9e}
.item.rem{border-left-color:#8a6d3b}
.badge.rem{background:#8a6d3b}
.item{scroll-margin-top:14px}
a.jump{margin-left:10px;color:#8a94a6;text-decoration:none;font-size:12px;border-bottom:1px dotted #b9c1cd}
a.jump:hover{color:#c8506e;border-bottom-color:#c8506e}
/* 待写章 / 待补节：只有原书目录骨架，没有讲义条目 */
.chapter.pending{border-style:dashed;background:#fcfcfd}
.chapter.pending>h2{background:#f2f3f6;color:#3f4a5a;border-bottom:2px solid #b9c1cd}
.ptag{display:inline-block;background:#e6e9ef;color:#5a6675;border:1px solid #ccd3dd;border-radius:20px;
      font-size:12px;padding:0 10px;margin-left:12px;vertical-align:3px;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.pnote{color:var(--mut);font-size:12.5px;padding:10px 24px 0;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.pendsec .pnote{padding:3px 0 0}
.sec.pendsec>h3{color:#4a5568}
.sec.pendsec>h3 .pno{margin-left:10px;border-color:#e2e6ec;background:#f4f6f9}
ul.subs{margin:4px 0 8px;padding-left:24px;color:var(--mut);font-size:13.2px;
        font-family:"Microsoft YaHei","PingFang SC",sans-serif;line-height:1.75}
ul.subs li{margin:2px 0}
a.tocitem.pend{color:#6a7689;border-style:dashed}
details.tocch.pending summary{color:#6a7689}
.pendsec:target{background:#fdf6e3}
`;

const SCRIPT = `
(function(){
  var kw = document.getElementById('kw');
  var box = document.getElementById('results');
  var MAX = 20;
  function render(){
    var q = kw.value.trim().toLowerCase();
    box.innerHTML = '';
    box.className = 'results';
    if (!q) return;
    var items = document.querySelectorAll('.item, .pendsec');
    var list = [];
    for (var i = 0; i < items.length; i++){
      var hay = (items[i].textContent + ' ' + (items[i].getAttribute('data-kw') || '')).toLowerCase();
      if (hay.indexOf(q) !== -1) list.push(items[i]);
    }
    var show = list.slice(0, MAX);
    for (var j = 0; j < show.length; j++){
      var it = show[j];
      var bd = it.querySelector('.badge');
      var badge = bd ? bd.textContent.trim() : (it.getAttribute('data-num') || '');
      var stmt = (it.getAttribute('data-kw') || '').replace(/^[\\d.]+\\s*/, '').replace(/\\s+/g, ' ').trim();
      if (!stmt && it.querySelector('.stmt')) stmt = it.querySelector('.stmt').textContent.trim().replace(/\\s+/g, ' ');
      if (stmt.length > 64) stmt = stmt.slice(0, 64) + '…';
      var a = document.createElement('a');
      a.className = 'res';
      a.href = '#' + it.id;
      var b = document.createElement('b');
      b.textContent = badge;
      a.appendChild(b);
      a.appendChild(document.createTextNode(stmt));
      box.appendChild(a);
    }
    if (list.length === 0){
      var none = document.createElement('div');
      none.className = 'resnone';
      none.textContent = '无匹配结果：' + kw.value.trim();
      box.appendChild(none);
    } else if (list.length > MAX){
      var more = document.createElement('div');
      more.className = 'resmore';
      more.textContent = '… 共 ' + list.length + ' 条，请输入更精确的关键词';
      box.appendChild(more);
    }
    box.className = 'results show';
  }
  kw.addEventListener('input', render);
  kw.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){
      var first = box.querySelector('a.res');
      if (first) first.click();
    }
  });
  document.addEventListener('click', function(e){
    if (e.target !== kw && !box.contains(e.target)){
      box.innerHTML = ''; box.className = 'results';
    }
  });
  box.addEventListener('click', function(){
    box.innerHTML = ''; box.className = 'results';
  });
})();
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(CFG.title)}</title>
<style>
${pageCss}
${LOCAL_CSS}
</style>
<style data-mathjax="inline">
${fontsCss}
${engineCss}
</style>
</head>
<body>
<div class="wrap">
<header><h1>${esc(CFG.header.h1)}</h1><div class="sub">${esc(CFG.header.sub)}</div><div class="stat"><span>共 ${total} 条</span>${stat}${pendStat}</div></header>
<div class="searchbox">
<input id="kw" type="text" placeholder="${esc(CFG.header.searchPlaceholder)}">
<div id="results" class="results"></div>
</div>
<nav class="toc"><b>目录</b>（点击章节展开，可直达任意定义 / 定理 / 引理 / 推论 / 命题）${toc.join('')}</nav>
${body.join('\n')}
<footer>${esc(CFG.footer)}</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

/* ---------- 自检 ---------- */
const warns = [];
const ids = [];
for (const c of chapters) for (const it of c.items) ids.push(it.id);
const dupId = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dupId.length) warns.push('重复 id: ' + [...new Set(dupId)].join(', '));

for (const c of chapters) for (const it of c.items) {
  if (!it.html.trim()) warns.push('空陈述: ' + it.id);
  if (!PAGE[it.secNum]) warns.push('缺页码表条目: ' + it.id + '（节 ' + it.secNum + '）');
  if (!EN_SEC[it.secNum]) warns.push('缺英文节名: ' + it.secNum);
}
const eqnoN = (html.match(/class="eqno"/g) || []).length;
const eqN = (html.match(/class="eq"/g) || []).length;
if (eqnoN > eqN) warns.push('公式编号多于行间公式');
const tagIds = [];
for (const m of html.matchAll(/原书式 \(([\d.]+)\)/g)) tagIds.push(m[1]);
const dupTag = tagIds.filter((x, i) => tagIds.indexOf(x) !== i);
if (dupTag.length) warns.push('索引内公式号重复: ' + [...new Set(dupTag)].join(', '));

console.log('OK: ' + path.basename(OUT) + '  (' + (Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2) + ' MB, ' + total + ' 条)');
console.log('    公式块 ' + mcache.size + ' 个，行间公式 ' + eqN + '（带编号 ' + eqnoN + '），引擎字符 CSS ' + engineCss.length + ' 字符');
console.log('   ', JSON.stringify(cnt));
if (Object.keys(CHAPTER_FILES).length) console.log('    目录胶囊直达正文：' + Object.keys(CHAPTER_FILES).length + ' 章');
if (warns.length) { console.log('\n[自检提示]'); for (const w of warns) console.log('  ! ' + w); }
else console.log('    自检：id 唯一、陈述非空、页码与英文名齐全 —— 通过');
