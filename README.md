# lecture-generator · 数学讲义生成 Skill

把一本数学教材逐节写成可读、自足的讲义：核心不是排版，而是把原书省略掉的东西补回来——跳步的推导展开、引用的定理就地解释、新概念在首次出现处翻译成人话。

## 产出线

- HTML 三色版：单文件、完全离线，白话注解分紫/灰/青三色，适合打印与分发
- HTML 纯色版：深蓝主题、侧栏目录，KaTeX 预渲染 + 内嵌字体
- 索引页：全书定义/定理抽成离线可搜、可跳正文的索引（两版通用）
- PDF 讲义版：Markdown 转 LaTeX，分色盒 + 夹注，A4 精读向，不带习题
- PDF 教学版：带例题、真题、习题与长例题的课堂版式
- PDF 书版：elegantbook 直排，带封面章节页

另含「手写版讲义转换」工作流：读取讲义或原书 PDF 上的手写批注，按论证顺序融回正文重出讲义。

## 依赖

- Python >= 3.10
- Node.js >= 18（HTML 构建；需 katex、mathjax-full，或用环境变量指向已有安装）
- TeX Live 2023+（XeLaTeX；PDF 三版需要）

## 环境变量

| 变量 | 用途 |
|---|---|
| TEXLIVE_ROOT | TeX Live 根目录，如 C:/texlive/2026 |
| KATEX_ROOT | katex 包根目录（缺省自动 require.resolve） |
| MATHJAX_ROOT | mathjax-full 包根目录（缺省自动发现） |

## 快速上手

1. 将本目录放入 Agent 技能目录（如 ~/.workbuddy/skills/），Agent 通过 SKILL.md 识别。
2. 说「把这本书做成讲义」或「继续写下一节」，并选择 HTML 还是 PDF、哪一版。
3. PDF 构建前设置 TEXLIVE_ROOT；HTML 构建前确认 node 与 katex/mathjax-full 可用。

## 校验

```bash
python html/check-md.py    contentN.md
python html/check-refs.py  contentN.md
```

HTML 成品再跑 check-html-threecolor.py / check-html-solid.py；PDF 日志 grep '^!' 应为 0，并视觉抽查 3-5 页。

## 许可

本 skill 规则与脚本供个人学习与非商业使用。pdf-teaching/original_maki.tex 为第三方模板（B 站「Maki 的完美算术教室」），允许商用与二次开发，署名请勿移除。
