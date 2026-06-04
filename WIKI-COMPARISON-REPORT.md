# Wiki 生成对比校验报告

对真实仓库用 CodeWiki 实时生成 Wiki，并与参考结构（deepwiki.com 同款分层规范）逐项对比。
界面与文档不体现第三方品牌，仅用作内部对齐基准。

- LLM: DeepSeek `deepseek-chat`（临时 Key，仅本次会话）
- 校验工具: `codewiki wiki-check`（15 项对齐规则，0–100% + A/B/C/D 评级）
- 测试仓库:
  - `sindresorhus/is`（扁平结构仓库，作为外部参考对比目标）
  - `CodeWiki` 自身（多目录结构，自举验证）

---

## 1. 对齐评分结果

### sindresorhus/is（hierarchical 分层导览）

| 页面 | 对齐度 | 评级 |
|------|--------|------|
| 1 Overview | 87% | A |
| 2 Core Architecture | 100% | A |
| 2.1 Source | 100% | A |
| 2.2 Test | 100% | A |
| 5 API Reference | 100% | A |
| **总体** | **97%** | **A（aligned）** |

唯一扣分项：Overview 页缺少 `file#Lxx-Lyy` 行级引用（LLM 未在 Sources 中带行号）。

### CodeWiki 自身（hierarchical 分层导览，9 页）

| 页面 | 对齐度 |
|------|--------|
| 1 Overview / 2 Core Architecture | 100% |
| 2.1 Cli / 2.2 Src/services / 2.3 Components | 100% |
| 2.4 Ts Project/services / 2.5 Py Project/services | 100% |
| 2.6 Vscode Extension/src / 9 API Reference | 100% |
| **总体** | **100% A（aligned）** |

### 三套提示词风格对比（sindresorhus/is）

| 风格 | 总体对齐度 | 评级 | 说明 |
|------|-----------|------|------|
| hierarchical 分层导览 | 97% | A | 对标分层编号 + 行级 Sources 引用规范 |
| engineering 工程详解 | 85% | B | 设计文档风格（契约/不变式/权衡），刻意偏离分层规范 |
| concise 速读概览 | 88% | B | TL;DR 精炼风格，图表/表格更少，符合预期 |

engineering/concise 评分略低是**设计使然**——它们针对不同文档目的，在分层规范的 15 项规则下本就不会满分。

---

## 2. 结构对比

### 参考结构（deepwiki.com/sindresorhus/is，13 页）

```
1 Overview
2 Core API
  2.1 Type-Checking Functions
  2.2 Type System Foundation
  2.3 Utility Functions
3 Build System
  3.1 / 3.2
4 Testing Framework
5 Development Workflow
  5.1 / 5.2
6 Project Information
```

### CodeWiki 生成结构（sindresorhus/is，5 页）

```
1 Overview
2 Core Architecture
  2.1 Source
  2.2 Test
5 API Reference
```

**结论**：层级编号格式（1 / 2 / 2.x）已对齐；页面数量少于参考（5 vs 13）。
原因是 `is` 是单文件库（`source/index.ts` + `source/types.ts`），CodeWiki 基于
真实模块/文件结构生成页面，不会人为拆分出 Build/Testing/Workflow 等参考方
按主题硬分的页面。对结构更丰富的仓库（如 CodeWiki 自身 9 页），页面数量随
模块数量自然增长。

---

## 3. 本轮修复（提交到 PR #1）

定位并修复了导致结构错乱、对齐度偏低的根因，均在 `cli/codewiki-cli.ts`：

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | 模块页标题为 `.` | 扁平仓库根目录 `.` 被当作模块名 | 扁平仓库改为按源文件分组生成子页 |
| 2 | 生成报 `ENOENT ...2.1-source\index.md` | Windows `\` 路径分隔符进入 slug | 规范化路径分隔符 + slug 仅保留 `[a-z0-9-]` |
| 3 | 多个页面标题重复（如 3×"Services"） | 不同目录同名 base（`src/services`、`cli/services`…） | base 冲突时用「父目录/base」消歧 |
| 4 | 子页面缺少 H1，wiki-check 标题显示为 "Wiki" | 误把以 `##` 开头也判为已有 H1 | 仅当以 `# ` 开头才视为已有 H1 |
| 5 | 缺少 "Relevant source files" 区块 | 之前移除了硬编码前缀 | 按页面相关文件确定性注入到 H1 之后 |
| 6 | 部分页缺少 `Sources:` 引用 | LLM 偶发遗漏 | 缺失时用相关文件确定性补一行 `Sources:` |

修复前后（sindresorhus/is，hierarchical）：**65% C → 97% A**。

回归验证：准确性测试 **43/43 全部通过**（34 TS + 9 Python），`tsc --noEmit` 0 错误。

---

## 4. 复现命令

```bash
export CODEWIKI_API_KEY=<deepseek-key>
# 生成
codewiki wiki-generate --style hierarchical --provider deepseek \
  --model deepseek-chat --out wiki-output-is -p /path/to/sindresorhus-is
# 校验
codewiki wiki-check wiki-output-is
```

---

## 5. 后续可选改进

- Overview 页强制带行级 `file#Lxx-Lyy` 引用（当前唯一非满分项）。
- 对扁平仓库可按「主题」（类型检查 / 工具函数 / 测试 / 构建）二次聚类，
  进一步贴近参考的 13 页拆分粒度。
- 为 engineering / concise 风格定制各自的对齐规则集（当前统一用分层规范打分）。
