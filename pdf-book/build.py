# -*- coding: utf-8 -*-
"""
《抽象代数讲义（合订本）》构建脚本 —— 严格按 Jacobson, Basic Algebra I (2nd ed.) 章序。

章序（= 原书前四章 + 两个附录）：
  第 1 章  幺半群与群        ch1_01..ch1_07                     （抽代一）
  第 2 章  环                ch2_01..ch2_04 + bodyD3/D4/D5       （抽代一 + 抽代二·群论补充）
  第 3 章  主理想整环上的模    bodyA/bodyB/bodyC/bodyC2            （抽代二·模论）
  第 4 章  Galois 理论        bodyD1/D2 + ch4_01..03 + bodyE1..E11（抽代一·域论 + 抽代二）
  附录 A   集合、整数与基数    appA
  附录 B   环论补遗            appB

归位说明：原《抽代二》的「群论补充」章被拆散——
  · D3（群作用与 Sylow 定理）、D4（可解群）、D5（自由群与生成元、关系）
      → 并入第 2 章末尾（对应原书第 2 章后半的群论工具）
  · D1（对称群与置换的循环分解）、D2（置换的奇偶性与交错群）
      → 并入第 4 章 Galois 理论开头（作为 Galois 群的前置）
原书本身没有独立的「群论 II」章，故不设该章。
"""
import io, os, re, shutil, subprocess

SRC = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(SRC, "_work")
TL = os.environ.get("TEXLIVE_ROOT", "")  # TeX Live 根目录，如 C:/texlive/2026
BIN = os.path.join(TL, "bin", "windows")

report = io.StringIO()
def log(*a):
    report.write(" ".join(str(x) for x in a) + "\n")

def rd(name):
    return open(os.path.join(SRC, name), encoding="utf-8").read()

def clean(txt, drop_chapter=True):
    """去掉文件头部的骨架命令（\\chapter、\\begin{document}、\\frontmatter、\\mainmatter 等）。"""
    if drop_chapter:
        txt = re.sub(r"\\chapter\{[^}]*\}\s*\n", "", txt)
    txt = re.sub(r"\\begin\{document\}", "", txt)
    txt = re.sub(r"\\end\{document\}", "", txt)
    txt = re.sub(r"\\frontmatter", "", txt)
    txt = re.sub(r"\\mainmatter", "", txt)
    txt = re.sub(r"\\MakeTitlePage", "", txt)
    txt = re.sub(r"\\tableofcontents", "", txt)
    txt = re.sub(r"\\chapter\*\{前言\}.*?(?=\\section|\\chapter|\Z)", "", txt, flags=re.S)
    return txt.strip()

os.makedirs(WORK, exist_ok=True)
shutil.rmtree(os.path.join(WORK, "assets"), ignore_errors=True)
shutil.copytree(os.path.join(SRC, "assets"), os.path.join(WORK, "assets"))

chunks = []

# ================= 第 1 章：幺半群与群 =================
# 注：《抽代一》分片内部已含 \chapter{...}，不重复补章标题。
for p in ["ch1_01", "ch1_02", "ch1_03", "ch1_04", "ch1_05", "ch1_06", "ch1_07"]:
    fn = p + ".tex"
    if os.path.exists(os.path.join(SRC, fn)):
        chunks.append(rd(fn))
    else:
        log("警告：缺少 %s" % fn)

# ================= 第 2 章：环 =================
# 章标题由 ch2_01 自带；其后接环论各节、多项式理论（ch3_01），再并入抽代二的群论补充 D3/D4/D5。
chunks.append(rd("ch2_01.tex"))                 # 首片保留自己的 \chapter{环}
for p in ["ch2_02", "ch2_03", "ch2_04", "ch3_01", "ch3_02"]:
    fn = p + ".tex"
    if os.path.exists(os.path.join(SRC, fn)):
        chunks.append(clean(rd(fn), drop_chapter=False))
    else:
        log("注意：%s 不存在，跳过" % fn)

# 群论补充（原抽代二 D3/D4/D5）→ 第 2 章末尾
for k in ("bodyD3", "bodyD4", "bodyD5"):
    chunks.append(clean(rd(k + ".tex"), drop_chapter=True))

# ================= 第 3 章：主理想整环上的模 =================
chunks.append(r"\chapter{主理想整环上的模 —— Modules over a PID}")
chunks.append(clean(rd("bodyA.tex")))
for k in ("bodyB", "bodyC", "bodyC2"):
    chunks.append(clean(rd(k + ".tex"), drop_chapter=False))

# ================= 第 4 章：Galois 理论 =================
# 开头是置换群（原抽代二 D1/D2），接着是域论（抽代一 ch4_01..03），再是 Galois 主体。
chunks.append(r"\chapter{Galois 理论 —— Galois Theory}")
for k in ("bodyD1", "bodyD2"):
    chunks.append(clean(rd(k + ".tex"), drop_chapter=True))
for p in ["ch4_01", "ch4_02", "ch4_03"]:
    fn = p + ".tex"
    if os.path.exists(os.path.join(SRC, fn)):
        chunks.append(clean(rd(fn), drop_chapter=True))
    else:
        log("警告：缺少 %s" % fn)
for k in ("bodyE1", "bodyE2", "bodyE3", "bodyE4", "bodyE5", "bodyE6",
          "bodyE7", "bodyE8", "bodyE9", "bodyE10", "bodyE11"):
    chunks.append(clean(rd(k + ".tex"), drop_chapter=True))

# ================= 附录 =================
chunks.append(r"\appendix")
chunks.append(r"\chapter{集合、整数与基数}")
chunks.append(clean(rd("appA.tex"), drop_chapter=True))
chunks.append(r"\chapter{环论补遗：四元数、反同构与多项式}")
chunks.append(clean(rd("appB.tex"), drop_chapter=True))

PREFACE = rd("preface.tex")
tpl = rd("eb_main.tex")
main = tpl.replace("%%PREFACE%%", PREFACE).replace("%%BODY%%", "\n\n".join(chunks))
open(os.path.join(WORK, "main.tex"), "w", encoding="utf-8").write(main)
log("已写出 main.tex (%d 字符)" % len(main))

# 清掉旧辅助文件，避免 multiply defined
for ext in (".aux", ".toc", ".out"):
    f = os.path.join(WORK, "main" + ext)
    if os.path.exists(f):
        os.remove(f)

env = dict(os.environ)
env["PATH"] = BIN + ";" + env.get("PATH", "")
env["LC_ALL"] = "en_US.UTF-8"

for i in (1, 2):
    p = subprocess.run([os.path.join(BIN, "xelatex.exe"), "-interaction=nonstopmode",
                        "-halt-on-error", "main.tex"],
                       cwd=WORK, capture_output=True, text=True, env=env, timeout=900)
    log("xelatex pass %d rc=%s" % (i, p.returncode))
    if p.returncode != 0:
        log(p.stdout[-8000:])
        break

open(os.path.join(WORK, "_build.txt"), "w", encoding="utf-8").write(report.getvalue())
print(report.getvalue())
