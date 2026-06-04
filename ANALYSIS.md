# CodeWiki 深度可行性分析报告

> 核心目标：提高 AI 编码准确性，解决大模型改代码幻觉问题

---

## 一、严重 Bug（阻断核心功能）

### BUG-1: VectorStore 每次重新创建空实例 ❌ 致命

**位置**: `ChatPanel.tsx:41`, `CodeAgentPanel.tsx:35`

```ts
// 每次用户发消息，都创建一个全新的空 VectorStore
const vectorStore = new VectorStore()  // ← 空的！索引数据全丢
const codeAgent = new CodeAgent(llm, vectorStore)
```

**影响**: Chat 和 Code Agent 的语义搜索完全失效 —— 搜索结果永远为空。这是"AI 编码准确性"的基础，不修必死。

**修复方案**: 用全局单例或 Zustand store 管理 VectorStore 实例，在索引阶段创建，全组件共享。

---

### BUG-2: GitHub 仓库索引返回空本体图 ❌

**位置**: `indexer.ts:165`

```ts
ontologyGraph: { entities: [], relations: [] }  // ← 空图谱
```

GitHub 模式下 `fetchGitHubTree` 只获取了文件列表，没有读取文件内容、没有构建本体。Wiki/搜索/Code Agent 全部失效。

**修复方案**: GitHub 模式也需要 fetch 文件内容 → 构建 ontology → 构建 vector store。

---

### BUG-3: MCP Server 是空壳 ❌

**位置**: `server/mcp-server.ts`

整个文件只有 `console.log`，没有任何 MCP 协议实现。没有 JSON-RPC、没有 stdio transport、没有 tool handler。

**修复方案**: 使用 `@modelcontextprotocol/sdk` 的 `StdioServerTransport` 实现真正的 MCP server。

---

### BUG-4: Code Agent 只分析不执行 ❌

**位置**: `code-agent.ts`

Agent 只返回修改建议 JSON，没有实际写入文件的能力。用户看到建议后无法一键应用。

**修复方案**: 通过 Electron IPC 添加 `writeFile` 能力，Agent 分析完后支持一键 Apply。

---

## 二、本体语义模型分析 (ontology.ts)

### 当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| Class 提取 | ✅ 可用 | JS/TS/Python 基础 class 声明 |
| Interface 提取 | ✅ 可用 | TypeScript interface |
| Function 提取 | ✅ 可用 | JS/TS/Python/Go/Rust |
| Import 关系 | ⚠️ 部分 | 路径匹配用 `includes`，会产生误匹配 |
| 继承关系 (extends) | ✅ 可用 | 通过 deferred relation |
| 实现关系 (implements) | ✅ 可用 | 通过 deferred relation |
| 调用关系 (calls) | ⚠️ 部分 | O(n²) 暴力匹配，大项目会慢 |
| 影响分析 (BFS) | ✅ 可用 | 深度可控的 BFS 图遍历 |
| 方法→类关联 | ❌ 缺失 | 方法没有链接到所属 class |
| 类型流追踪 | ❌ 缺失 | 无法追踪参数/返回值的类型传递 |
| 作用域区分 | ❌ 缺失 | 不同文件的同名函数会混淆 |

### 关键缺陷

**1. Regex 无法处理复杂语法**
```ts
// 以下都无法被正确提取：
@Component({...})           // 装饰器
class Foo<T extends Bar>    // 泛型
const handler = async ({a, b}: Props) => {...}  // 解构参数箭头函数
export const Component: React.FC<Props> = ({...}) => {...}  // React FC
```

**2. Block End 检测不可靠**
```ts
findBlockEnd() // 用大括号计数，但不排除字符串/注释中的大括号
// 例如: const s = "{ fake brace }" 会导致计数错误
```

**3. 调用关系检测是全局匹配**
```ts
// 如果项目有 100 个 function name，每个实体都要测试 100 个 regex
// 1000 entities × 100 functions = 100,000 次 regex 测试
// 而且同名函数会产生错误的 calls 关系
```

### 评估: 可行性 60%
适合小中型项目（<500 文件），大型项目会出现：性能问题、误匹配、遗漏。

---

## 三、语义搜索分析 (vector-store.ts)

### 当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| TF-IDF 计算 | ✅ 可用 | 标准 TF-IDF + 余弦相似度 |
| camelCase 分词 | ✅ 可用 | `getUserById` → `get`, `user`, `by`, `id` |
| snake_case 分词 | ✅ 可用 | `get_user` → `get`, `user` |
| 真正的语义嵌入 | ❌ 缺失 | `embedding?: number[]` 字段存在但从未使用 |
| 代码专用停词 | ❌ 缺失 | `function`, `return`, `const` 等高频低信息词未过滤 |
| 索引持久化 | ❌ 缺失 | 刷新页面后索引丢失 |

### 关键缺陷

**"语义搜索"实际是关键词搜索**：TF-IDF 只能匹配词汇重叠，不能理解语义。例如搜"用户认证"不会匹配 `AuthService`、`login`、`jwt`。

**修复方案（分层）**：
1. **短期**: 添加代码停词表 + 同义词映射 (auth↔login↔authenticate)
2. **中期**: 接入 OpenAI `text-embedding-3-small` 做真正的向量嵌入
3. **长期**: 本地 ONNX 模型做离线嵌入 (如 all-MiniLM-L6)

### 评估: 可行性 50%
关键词匹配勉强可用，但达不到"语义"级别。

---

## 四、Code Agent 分析 (code-agent.ts)

### 当前管道

```
用户请求
  ↓
Step 1: vectorStore.search(request, 10)    ← 因 BUG-1 永远返回空
  ↓
Step 2: findRelevantEntities(request, graph) ← 仅关键词匹配 entity.name
  ↓
Step 3: getImpactedEntities(BFS, depth=2)   ← 逻辑正确
  ↓
Step 4: 读取影响文件内容(最多10个，每个截取3000字)
  ↓
Step 5: LLM 生成修改方案(JSON格式)         ← max_tokens=4096 太小
```

### 关键缺陷

**1. 修复 BUG-1 后管道可工作，但精度不够**：
- `findRelevantEntities` 只做名称关键词匹配，搜"添加验证"不会找到 `UserService`
- 影响分析的 depth=2 可能不够（A→B→C→D 的调用链需要 depth≥3）

**2. LLM 输出解析不够健壮**：
```ts
const jsonMatch = response.content.match(/\{[\s\S]*\}/)  // 贪婪匹配，多个 JSON 对象会出错
```

**3. 没有回写验证**：
- Agent 返回的 `startLine`/`endLine` 可能和实际文件不一致
- 没有检查 `originalContent` 是否匹配文件实际内容

**4. 没有多轮修改能力**：
- 不能先修改 A，再基于修改后的 A 修改 B
- 大型重构需要多轮协调

### 评估: 可行性 35%
架构正确但实现不完整。修复 BUG-1 + 添加写入能力后可达到 60%。

---

## 五、各模块可行性汇总

| 模块 | 当前可行性 | 修复后预期 | 核心阻断问题 |
|------|-----------|-----------|-------------|
| 本体模型 | 60% | 80% | Regex 局限、无方法归属 |
| 语义搜索 | 50% | 75% | 无真正嵌入、BUG-1 |
| Code Agent | 35% | 70% | BUG-1、无执行能力、上下文小 |
| Wiki 生成 | 70% | 85% | 上下文截断、无增量更新 |
| 知识图谱可视化 | 75% | 85% | 取决于本体模型质量 |
| MCP Server | 20% | 80% | 完全是空壳 |
| VSCode 插件 | 25% | 60% | 无后端 HTTP server |
| Electron IPC | 80% | 90% | GitHub 模式空图谱 |
| 数据持久化 | 30% | 80% | 无保存/加载机制 |

---

## 六、建议修复优先级（围绕 AI 编码准确性）

### P0 — 必须修复（核心功能不可用）

1. **修复 VectorStore 单例** — 让搜索真正工作
2. **实现 Code Agent 的文件写入** — 让修改真正可执行
3. **加强 ontology 提取** — 方法→类关联、作用域区分、减少误匹配
4. **增加上下文窗口** — max_tokens 4096→16384，文件截取 3000→8000

### P1 — 重要改进

5. **实现 MCP Server** — 用 `@modelcontextprotocol/sdk` 做真正的 stdio server
6. **数据持久化** — 索引结果保存到 Electron userData，避免重复索引
7. **GitHub 仓库完整索引** — fetch 文件内容 + 构建完整本体
8. **添加修改验证** — 应用前对比 originalContent 与实际文件

### P2 — 质量提升

9. **接入真正的向量嵌入** — OpenAI embeddings 或本地 ONNX 模型
10. **优化调用关系检测** — 预构建名称索引，避免 O(n²)
11. **支持多轮代码修改** — 修改→验证→再修改的循环
12. **VSCode 插件后端** — 添加 HTTP server 连接桌面端

---

## 七、技术风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Regex 提取在复杂代码上大量遗漏 | 高 | 高 | 分阶段：先 regex 覆盖 80%，后续加 tree-sitter WASM |
| LLM 上下文不够导致修改不精确 | 中 | 高 | 精选上下文（只送相关实体代码，不送整文件）|
| 大型项目（10K+ 文件）性能问题 | 中 | 中 | 增量索引 + worker thread |
| 向量搜索质量不够 | 高 | 中 | 先用 TF-IDF + ontology 增强，后加嵌入 |

---

## 八、结论

**当前状态**: 架构设计合理，但有 4 个致命 Bug 导致核心功能（搜索、Code Agent、MCP）完全不可用。

**乐观估计**: 修复 P0 的 4 个问题后，本地项目的基本流程（索引→Wiki→搜索→Code Agent 修改）可以跑通，AI 编码准确性可达到"比裸 LLM 好"的水平。

**建议**: 先集中修复 P0，然后逐步推进 P1。P2 可以在基本流程验证后再做。
