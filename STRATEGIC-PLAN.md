# CodeWiki 战略规划文档

## 一、当前系统现状审计

### 已完成功能
| 模块 | 功能 | 状态 |
|------|------|------|
| Desktop App | 项目选择 (本地文件夹/GitHub URL) | Done |
| Desktop App | 代码索引 + 进度条 | Done |
| Desktop App | Wiki 生成 (6 页, LLM) | Done |
| Desktop App | Wiki 阅读 (Markdown + Mermaid) | Done |
| Desktop App | 知识图谱可视化 (D3-force) | Done |
| Desktop App | 语义搜索 (TF-IDF + 本体) | Done |
| Desktop App | RAG Chat (上下文问答) | Done |
| Desktop App | Code Agent (分析+修改+应用) | Done |
| Desktop App | 设置 (LLM Provider/Key/Model/BaseURL) | Done |
| Desktop App | 数据持久化 (Electron userData) | Done |
| CLI | 10 个命令 (index/analyze/pre-check/verify/impact/deps/entity/search/validate/test) | Done |
| CLI | Python + TypeScript 语言支持 | Done |
| CLI | 准确性测试套件 (30/30 通过) | Done |
| MCP | 7 个工具 (stdio transport) | Done |
| Ontology | 两阶段构建 (实体提取→关系解析) | Done |
| Ontology | 作用域标识符 (file::class::method) | Done |
| Ontology | BFS 影响分析 | Done |

### 发现的缺失功能/Gap

#### 系统设置层面 (System Settings)
1. **索引深度硬编码** → `depth > 8` 固定在3个文件中
2. **文件大小限制硬编码** → `500_000` 字节在3个文件中
3. **代码扩展名硬编码** → `CODE_EXTENSIONS` 在3个文件中
4. **忽略目录硬编码** → `IGNORED_DIRS` 在3个文件中
5. **LLM 温度/max_tokens 硬编码** → `temperature: 0.3`, `max_tokens: 16384`
6. **向量搜索结果数硬编码** → `topK: 10`
7. **文件截断长度硬编码** → `8000` 字符
8. **影响分析阈值硬编码** → warning thresholds
9. **图谱布局参数硬编码** → force strength, distance, charge
10. **Wiki 生成页数硬编码** → 固定 6 页

#### 用户体验层面 (User Settings)
1. **无主题切换** → AppSettings 有 `theme: 'dark' | 'light'` 但未实现
2. **无语言设置** → 全英文界面，无 i18n
3. **无字体大小调节** → 固定字号
4. **无侧边栏宽度调节** → 固定 `w-64`
5. **无快捷键自定义** → 无快捷键系统
6. **无自动保存设置** → 手动触发
7. **无搜索历史** → 无记忆
8. **无最近项目列表** → 每次重新选择
9. **无 Wiki 导出** → 无法导出为 PDF/HTML
10. **无代码高亮主题** → 固定暗色

#### 桌面用户旅程 Gap
1. **无项目切换** → 打开后无法切换到另一个项目
2. **无重新索引** → 无法更新已索引的项目
3. **无索引状态持久化** → 关闭后丢失索引
4. **无文件监听** → 代码变更后不自动更新
5. **无实体点击跳转** → 侧边栏实体不可点击查看详情
6. **无代码预览** → 搜索结果/实体无法跳转查看源码
7. **无 Wiki 编辑** → 生成后不可手动编辑
8. **无 Wiki 导出/分享** → 无法分享给团队

#### IDE 旅程 Gap
1. **MCP Server 无配置系统** → 硬编码参数
2. **无 VSCode 插件实现** → 只有脚手架
3. **MCP 无增量更新** → 每次全量构建本体
4. **MCP 无缓存** → 无法复用之前的索引
5. **MCP 无文件监听** → 改代码后需要手动重新索引

#### Code Agent 旅程 Gap
1. **CLI 无配置文件** → 无 `.codewikirc` 或类似配置
2. **CLI 无 diff 输出** → verify 只报告有/无变化，不显示 diff
3. **CLI 无 rollback 命令** → 无法回滚修改
4. **CLI 无批量操作** → 一次只能查一个实体
5. **CLI 无 watch 模式** → 无法持续监听变更
6. **CLI 无 apply 命令** → Code Agent 无法通过 CLI 直接修改代码
7. **CLI 无输出格式选项** → 只有 JSON 和纯文本

---

## 二、系统设置架构 (System Settings)

### 设置分层
```
codewiki.config.json (项目级) → ~/.codewiki/config.json (全局级) → 内置默认值
```

### 系统级可配置项

#### 1. 索引配置 (Indexing)
| 设置 | 当前值 | 类型 | 说明 |
|------|--------|------|------|
| `indexing.maxDepth` | 8 | number | 目录遍历最大深度 |
| `indexing.maxFileSize` | 500000 | number | 单文件最大字节数 |
| `indexing.extensions` | [...] | string[] | 索引的文件扩展名 |
| `indexing.ignoreDirs` | [...] | string[] | 忽略的目录 |
| `indexing.ignorePatterns` | [] | string[] | glob 模式忽略规则 |
| `indexing.autoReindex` | false | boolean | 文件变更自动重建索引 |
| `indexing.watchMode` | false | boolean | 启用文件监听 |

#### 2. LLM 配置 (AI)
| 设置 | 当前值 | 类型 | 说明 |
|------|--------|------|------|
| `llm.provider` | 'openai' | enum | LLM 提供商 |
| `llm.model` | 'gpt-4o' | string | 模型名称 |
| `llm.apiKey` | '' | string | API Key |
| `llm.apiBaseUrl` | '' | string | 自定义端点 |
| `llm.temperature` | 0.3 | number | 生成温度 |
| `llm.maxTokens` | 16384 | number | 最大 token 数 |
| `llm.contextWindow` | 8000 | number | 文件截断长度 |
| `llm.streamResponse` | true | boolean | 流式响应 |

#### 3. 本体配置 (Ontology)
| 设置 | 当前值 | 类型 | 说明 |
|------|--------|------|------|
| `ontology.impactDepth` | 3 | number | 影响分析 BFS 深度 |
| `ontology.warningThreshold.entities` | 20 | number | 实体数超过此值警告 |
| `ontology.warningThreshold.files` | 8 | number | 文件数超过此值警告 |
| `ontology.extractDecorators` | true | boolean | 是否提取装饰器 |
| `ontology.extractArrowFunctions` | true | boolean | 是否提取箭头函数 |

#### 4. 搜索配置 (Search)
| 设置 | 当前值 | 类型 | 说明 |
|------|--------|------|------|
| `search.maxResults` | 10 | number | 搜索最大返回数 |
| `search.minScore` | 0.01 | number | 最小相似度阈值 |
| `search.snippetLength` | 500 | number | 结果片段长度 |

#### 5. Wiki 配置 (Wiki)
| 设置 | 当前值 | 类型 | 说明 |
|------|--------|------|------|
| `wiki.pageCount` | 6 | number | 生成页面数 |
| `wiki.autoGenerate` | false | boolean | 索引完自动生成 Wiki |
| `wiki.includeMermaid` | true | boolean | 包含 Mermaid 图 |

#### 6. 图谱配置 (Graph)
| 设置 | 当前值 | 类型 | 说明 |
|------|--------|------|------|
| `graph.forceStrength` | -200 | number | 斥力强度 |
| `graph.linkDistance` | 80 | number | 连线距离 |
| `graph.collisionRadius` | 20 | number | 碰撞半径 |
| `graph.maxNodes` | 500 | number | 最大节点数 |

---

## 三、用户设置架构 (User Settings)

### 界面与体验
| 设置 | 默认值 | 类型 | 说明 |
|------|--------|------|------|
| `ui.theme` | 'dark' | 'dark'/'light'/'system' | 主题模式 |
| `ui.language` | 'en' | 'en'/'zh-CN'/'zh-TW'/'ja' | 界面语言 |
| `ui.fontSize` | 14 | number | 基础字号 |
| `ui.sidebarWidth` | 256 | number | 侧边栏宽度 |
| `ui.sidebarPosition` | 'left' | 'left'/'right' | 侧边栏位置 |
| `ui.showLineNumbers` | true | boolean | 代码显示行号 |
| `ui.wordWrap` | true | boolean | 自动换行 |

### 行为与偏好
| 设置 | 默认值 | 类型 | 说明 |
|------|--------|------|------|
| `behavior.autoSave` | true | boolean | 自动保存 |
| `behavior.autoSaveInterval` | 30000 | number | 自动保存间隔(ms) |
| `behavior.confirmBeforeApply` | true | boolean | 修改前确认 |
| `behavior.showWelcome` | true | boolean | 显示欢迎页 |
| `behavior.rememberLastProject` | true | boolean | 记住上次项目 |
| `behavior.maxRecentProjects` | 10 | number | 最近项目数 |

### 通知与反馈
| 设置 | 默认值 | 类型 | 说明 |
|------|--------|------|------|
| `notifications.showProgress` | true | boolean | 显示索引进度 |
| `notifications.showImpactWarning` | true | boolean | 显示影响警告 |
| `notifications.soundEnabled` | false | boolean | 声音提示 |

---

## 四、用户旅程地图

### 旅程 A：桌面用户 (Desktop User)

```
A1. 启动应用
 └─ 显示欢迎页 / 加载上次项目 (NEW: rememberLastProject)
    ├─ 最近项目列表 (NEW)
    ├─ 选择本地文件夹
    └─ 输入 GitHub URL

A2. 项目索引
 ├─ 扫描文件 → 进度条
 ├─ 构建本体图谱 → 进度条
 ├─ 创建向量索引 → 进度条
 └─ 完成 → 自动保存

A3. Wiki 浏览
 ├─ 查看生成的 Wiki 页面
 ├─ Mermaid 图表渲染
 ├─ 页面间导航 (前后翻页)
 ├─ Wiki 导出 (NEW: PDF/HTML/Markdown)
 └─ Wiki 手动编辑 (NEW)

A4. 知识图谱
 ├─ D3 力导向图
 ├─ 按类型过滤
 ├─ 缩放/拖拽
 ├─ 节点 hover → tooltip
 ├─ 节点点击 → 实体详情面板 (NEW)
 └─ 图谱导出 (NEW: SVG/PNG)

A5. 语义搜索
 ├─ 全文搜索 (Wiki + Code + Entity)
 ├─ 搜索类型过滤
 ├─ 结果列表 (score + snippet)
 ├─ 搜索历史 (NEW)
 └─ 结果点击 → 源码预览 (NEW)

A6. RAG Chat
 ├─ 自然语言提问
 ├─ 本体感知上下文
 ├─ 流式响应 (已有)
 ├─ 引用来源展示
 ├─ 聊天历史管理
 └─ 聊天导出 (NEW)

A7. Code Agent
 ├─ 描述修改需求
 ├─ 影响分析展示
 ├─ 修改预览 (diff view)
 ├─ 逐个应用 / 全部应用
 ├─ 修改后验证 (NEW)
 └─ 回滚 (NEW)

A8. 设置管理
 ├─ LLM 配置 (已有)
 ├─ 系统设置 (NEW: 索引/搜索/图谱配置)
 ├─ 用户设置 (NEW: 主题/语言/字号/布局)
 └─ 快捷键配置 (NEW)

A9. 项目管理
 ├─ 切换项目 (NEW)
 ├─ 重新索引 (NEW)
 ├─ 删除项目 (NEW)
 └─ 项目信息查看 (NEW)
```

### 旅程 B：IDE 用户 (VSCode + MCP)

```
B1. 配置 CodeWiki
 ├─ MCP Server 配置 (claude_desktop_config.json / VSCode settings)
 ├─ 项目路径配置 (PROJECT_PATH)
 └─ 配置验证 (NEW: health-check 工具)

B2. 首次使用
 ├─ MCP 自动索引项目
 ├─ 索引结果缓存 (NEW)
 └─ 增量索引 (NEW: 只处理变更文件)

B3. 代码查询
 ├─ search_code → 语义搜索
 ├─ get_entity → 实体信息
 ├─ get_impact → 影响分析
 ├─ get_dependencies → 依赖图
 └─ get_relations → 关系查询 (NEW)

B4. 代码修改分析
 ├─ pre_check → 修改前全面分析
 │   ├─ 目标实体信息
 │   ├─ 源代码
 │   ├─ 关系列表
 │   ├─ 影响范围
 │   ├─ 风险等级
 │   └─ 相关实体
 └─ verify_modification → 修改后验证

B5. 增量更新 (NEW)
 ├─ 文件变更通知
 ├─ 增量本体更新
 └─ 向量索引更新

B6. 统计和报告 (NEW)
 ├─ 项目概览统计
 ├─ 本体健康度
 └─ 代码复杂度报告
```

### 旅程 C：Code Agent (CLI)

```
C1. 项目准备
 ├─ codewiki index <path> → 索引项目
 ├─ codewiki index --incremental → 增量索引 (NEW)
 └─ codewiki status → 查看索引状态 (NEW)

C2. 修改前分析
 ├─ codewiki pre-check <entity> "<description>" → 全面分析
 ├─ codewiki impact <entity> → 影响范围
 ├─ codewiki deps <entity> → 依赖关系
 └─ codewiki analyze <query> → 语义分析

C3. 精确查询
 ├─ codewiki entity <name> → 实体信息
 ├─ codewiki search <query> → 语义搜索
 └─ codewiki relations <entity> → 关系列表 (NEW)

C4. 代码修改 (NEW)
 ├─ codewiki apply <file> <start> <end> "<new-content>" → 直接修改
 ├─ codewiki apply --from-json <plan.json> → 批量修改
 └─ codewiki rollback <file> → 回滚到备份

C5. 修改后验证
 ├─ codewiki verify <file> → 语法+实体验证
 ├─ codewiki diff <file> → 显示变更 diff (NEW)
 └─ codewiki validate <file> <range> → 范围安全性验证

C6. 项目配置 (NEW)
 ├─ codewiki config --init → 初始化配置文件
 ├─ codewiki config --get <key> → 读取配置
 └─ codewiki config --set <key> <value> → 修改配置

C7. 批量操作 (NEW)
 ├─ codewiki batch pre-check --entities entity1,entity2
 ├─ codewiki batch impact --entities entity1,entity2
 └─ codewiki batch apply --plan <plan.json>

C8. 测试验证
 ├─ codewiki test <suite-path> → 运行准确性测试
 └─ codewiki test --report → 生成测试报告 (NEW)
```

---

## 五、实施优先级

### P0 - 本次必须完成 (核心设置 + 关键缺失功能)
1. **统一配置系统** → `ConfigManager` + 配置文件 + 默认值
2. **设置 UI 重构** → 分 Tab (LLM / Indexing / UI / Behavior)
3. **主题切换实现** → Light/Dark/System
4. **最近项目列表** → WelcomeScreen 改造
5. **项目切换/重新索引** → TopBar 添加项目管理
6. **CLI config 命令** → `.codewikirc` 支持
7. **CLI apply 命令** → Code Agent 直接修改代码
8. **CLI rollback 命令** → 回滚到备份
9. **CLI diff 命令** → 显示变更
10. **CLI status 命令** → 查看索引状态

### P1 - 重要完善
1. **实体详情面板** → 点击实体查看详细信息
2. **搜索历史** → 记忆最近搜索
3. **源码预览** → 搜索结果/实体跳转查看源码
4. **MCP 增量索引** → 缓存 + 增量更新
5. **MCP health-check** → 配置验证工具
6. **CLI batch 操作** → 批量 pre-check/impact
7. **Wiki 导出** → Markdown/HTML 导出

### P2 - 锦上添花
1. **i18n 多语言** → 中文/英文界面
2. **文件监听 (watch)** → 自动更新索引
3. **图谱导出** → SVG/PNG
4. **聊天导出** → Markdown
5. **快捷键系统** → 全局快捷键
6. **VSCode 插件** → 完整实现
7. **Wiki 编辑** → 可手动修改

---

## 六、配置系统架构

```typescript
// src/services/config-manager.ts
interface CodeWikiConfig {
  indexing: IndexingConfig
  llm: LLMConfig
  ontology: OntologyConfig
  search: SearchConfig
  wiki: WikiConfig
  graph: GraphConfig
  ui: UIConfig
  behavior: BehaviorConfig
  notifications: NotificationConfig
}

// 配置加载优先级:
// 1. 项目级: <project>/.codewikirc 或 codewiki.config.json
// 2. 全局级: ~/.codewiki/config.json
// 3. 内置默认值: DEFAULT_CONFIG
```

存储方式:
- **Desktop App**: Electron `app.getPath('userData')` → JSON 文件
- **CLI**: `.codewikirc` (项目级) + `~/.codewiki/config.json` (全局)
- **MCP**: 环境变量 + 配置文件

---

## 七、技术方案

### 配置管理器
- `ConfigManager` 类: 负责加载、合并、验证、保存配置
- 支持 `get(path)` / `set(path, value)` / `reset(path)` 操作
- 配置变更事件: 让组件可以订阅配置变化

### 设置 UI
- 重构 `SettingsModal` → 分 Tab
- Tab 1: AI 设置 (Provider/Key/Model/温度/Token)
- Tab 2: 索引设置 (深度/大小/扩展名/忽略)
- Tab 3: 界面设置 (主题/字号/侧边栏)
- Tab 4: 行为设置 (自动保存/确认/记忆)

### 主题系统
- CSS 变量定义 Light/Dark 两套
- Tailwind CSS 自定义颜色通过 CSS 变量
- `<html>` 标签添加 `data-theme` 属性
- System 模式监听 `prefers-color-scheme`

### CLI 新命令
- `apply`: 接收 JSON plan，逐个应用修改，创建备份
- `rollback`: 读取 `.codewiki-backup` 文件恢复
- `diff`: 比较当前文件和备份文件
- `status`: 显示项目索引状态/统计
- `config`: 配置管理
