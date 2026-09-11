# -*- coding: utf-8 -*-
"""
样式表孤儿规则裁剪工具（一次性，随本轮 InsightDashboardPage 下线使用）。

原理：字符级大括号配平解析。顶层每条语句 = prelude（选择器/注释/前一语句后的间隙）
      + '{' body '}'。只有「prelude 中出现的类名 100% 属于孤儿集合」的规则才删除，
      保证绝不误伤共享选择器；@media/@supports 递归处理内层，内层全空才删整块；
      @keyframes 一律保留。
用法：python scripts/prune-insight-css.py [--apply]   # 默认 dry-run
"""
import re, io, sys

ROOT = r'E:\VStudio_Project\ai\Silicon Meridian'
P = ROOT + r'\src\styles.css'
ORPHANS = set(open(ROOT + r'\.insight_orphan_classes.txt', encoding='utf-8').read().split())
APPLY = '--apply' in sys.argv

CLASS_RE = re.compile(r'\.([A-Za-z_][\w-]*)')

def split_stmts(text, base=0):
    """返回 [(prelude, body, pos)]；pos 为该语句在原文中的起始偏移。"""
    stmts, i, n, buf = [], 0, len(text), 0
    while i < n:
        if text[i] == '{':
            j, d = i + 1, 1
            while j < n and d:
                if text[j] == '{': d += 1
                elif text[j] == '}': d -= 1
                j += 1
            stmts.append((text[buf:i], text[i + 1:j - 1], base + buf))
            buf = j
            i = j
        else:
            i += 1
    tail = text[buf:]
    if tail.strip():
        stmts.append((tail, '', base + buf))
    return stmts

def orphan_only(prelude):
    cls = set(CLASS_RE.findall(prelude))
    return bool(cls) and cls <= ORPHANS

COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)

def head_kind(prelude):
    """剥掉 prelude 里的注释后判断语句类型（注释黏在上一个 '}' 与语句之间）"""
    return COMMENT_RE.sub('', prelude).strip()

def prune(text, log, path=''):
    out = []
    for prelude, body, pos in split_stmts(text):
        head = head_kind(prelude)
        if head.startswith('@media') or head.startswith('@supports'):
            inner = prune(body, log, path + head[:40])
            if inner.strip():
                out.append(prelude + '{' + inner + '}')
            else:
                log.append(f'[删 @media 全空] {head[:60]}')
        elif head.startswith('@keyframes') or head.startswith('@font-face') or head.startswith('@charset'):
            out.append(prelude + '{' + body + '}')
        elif orphan_only(prelude):
            log.append(f'[删 规则] {head[:70]}')
        else:
            out.append(prelude + '{' + body + '}')
    return ''.join(out)

raw = io.open(P, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in raw else '\n'
# 统一按 \n 处理
text = raw.replace('\r\n', '\n')

log = []
pruned = prune(text, log)

# 尾部保护：原文末尾的换行保留
if text.endswith('\n') and not pruned.endswith('\n'):
    pruned += '\n'

print(f'删除条目 {len(log)}；字符 {len(text)} -> {len(pruned)}（约 {len(text) - len(pruned)} 字符）')

# ---- 安全断言：这些共享选择器必须仍在（均为 styles.css 内定义的哨兵） ----
for must in ['agent-workflow-layout', 'chat-layout', 'aviation-grid', 'new-badge',
             'profile-dashboard-kpis', 'news-item', 'profile-insights']:
    assert must in pruned, f'安全断言失败：{must} 不应被删！'
# ---- 反向断言：孤儿类不允许再以「独立规则」存在 ----
# （允许 .adopt .radar-quadrant-title 这类复合选择器——动态类名无法静态判定，
#   保守保留；但 .radar-quadrant-title 独占的选择器必须已消失）
def remaining_standalone(pruned):
    bad = []
    for m in re.finditer(r'\.([A-Za-z_][\w-]*)', pruned):
        c = m.group(1)
        if c not in ORPHANS:
            continue
        # 向前找本选择器的起点（上一个 '}' 或 '{' 之后）
        prev_close = max(pruned.rfind('}', 0, m.start()), pruned.rfind('{', 0, m.start()))
        nxt_open = pruned.find('{', m.start())
        sel = pruned[prev_close + 1:nxt_open if nxt_open > prev_close else m.start()]
        cls = set(CLASS_RE.findall(sel))
        if cls and cls <= ORPHANS:  # 该选择器里全是孤儿类 → 本应被删
            bad.append((c, sel.strip()[:60]))
    return bad

bad = remaining_standalone(pruned)
assert not bad, f'反向断言失败，仍有孤儿独占规则：\n' + '\n'.join(f'  {c}: {s}' for c, s in bad[:8])
print('安全断言全部通过')

if APPLY:
    io.open(P, 'w', encoding='utf-8', newline='').write(pruned.replace('\n', nl))
    print('已写回 styles.css')
else:
    io.open(ROOT + r'\.styles-pruned-preview.css', 'w', encoding='utf-8', newline='').write(pruned)
    print('dry-run：预览写入 .styles-pruned-preview.css（加 --apply 落盘）')
