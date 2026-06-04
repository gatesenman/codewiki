# CodeWiki — 源代码 Wiki

本目录是由 CodeWiki 对本仓库自身源代码自动生成的 Wiki 文档（hierarchical 分层风格），结构对齐校验 **100% (A 级)**。

生成命令：

```bash
codewiki index .
codewiki wiki-generate --style hierarchical --provider deepseek -p . --out wiki
codewiki wiki-check wiki
```

## 页面目录

| # | 页面 | 说明 |
|---|------|------|
| 1 | [Overview](1-overview.md) | 项目总览、目标、整体架构 |
| 2 | [Core Architecture](2-core-architecture.md) | 核心架构、设计模式、组件关系 |
| 2.1 | [CLI](2.1-cli.md) | `codewiki` 命令行工具（35+ 命令） |
| 2.2 | [Src / Services](2.2-src-services.md) | 桌面端核心服务（索引/本体/检索/Agent） |
| 2.3 | [Components](2.3-components.md) | React UI 组件 |
| 2.4 | [TS Project / Services](2.4-ts-project-services.md) | TypeScript 测试夹具模块 |
| 2.5 | [Py Project / Services](2.5-py-project-services.md) | Python 测试夹具模块 |
| 2.6 | [VSCode Extension / Src](2.6-vscode-extension-src.md) | VSCode 插件 |
| 9 | [API Reference](9-api-reference.md) | 类/接口/函数 API 参考 |

> 每页均包含：H1 标题、相关源文件、用途与范围、Mermaid 图、组件表格、行级 `Sources:` 引用（`file#Lxx-Lyy`）、相关页面链接。
