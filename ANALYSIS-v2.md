# CodeWiki 深度可行性分析 v2 — CLI 集成与 AI 编码准确性验证

## 一、核心目标

**Code Agent 改代码前，通过 CLI 查询 CodeWiki，获取全面分析后才动手改。**

工作流：
```
Code Agent (AI) → codewiki-cli analyze → 获取本体/影响/依赖 → 精确修改代码
                                          ↑
                                    CodeWiki 索引数据
```

## 二、当前架构能力评估

### 2.1 本体模型 (ontology.ts) — 能力: 75%

**已实现：**
- Class/Interface/Function/Method/Type/Enum/Component 提取
- 方法→类的 `contains` 关系
- 装饰器、泛型、箭头函数支持
- 作用域标识符 `file::class::method` 防止名称冲突
- BFS 影响分析（改 A 会影响 B, C, D）
- 调用关系检测（O(1) 索引查找）
- 字符串/注释感知的块结束检测

**不足：**
- Regex 无法处理复杂嵌套（如泛型内的泛型 `Map<string, Array<Promise<T>>>`）
- 无法解析动态调用 (`obj[method]()`)
- Python 缩进块检测仍不够健壮
- 缺少类型推导（无法追踪 `const x = getUser()` 的返回类型）
- 缺少变量/常量实体提取

### 2.2 语义搜索 (vector-store.ts) — 能力: 60%

**已实现：**
- TF-IDF 向量化 + 余弦相似度搜索
- camelCase/snake_case 自动分词
- IDF 权重计算

**不足：**
- 纯 TF-IDF，没有语义理解（"认证" 搜不到 "auth"）
- 中文代码注释搜索效果差
- 大项目（>1000文件）性能未优化
- 缺少同义词/语义映射

### 2.3 Code Agent (code-agent.ts) — 能力: 70%

**已实现：**
- 语义搜索 + 本体搜索双路径查找
- 影响分析约束（BFS 依赖图）
- 结构化 JSON 修改输出
- 文件写入 + 内容验证 + 自动备份
- LLM 上下文窗口 16384 tokens

**不足：**
- 单轮修改，无多轮迭代能力
- 无修改后验证（不检查语法/类型正确性）
- 缺少回滚机制（有备份但无自动回滚）
- JSON 解析失败时无 fallback 策略

### 2.4 MCP Server (server/mcp-server.ts) — 能力: 85%

**已实现：**
- @modelcontextprotocol/sdk stdio 传输
- 5 个工具：read_wiki, search_code, get_entity_info, get_dependencies, get_impact_analysis
- 自包含（内联本体构建 + TF-IDF）

**不足：**
- 与桌面应用不共享索引数据（独立构建）
- 缺少 `suggest_modification` 工具
- 缺少 `validate_modification` 工具

### 2.5 CLI 工具 — 能力: 0% (需新增)

**当前缺失，需要实现：**
- `codewiki index <path>` — 索引项目
- `codewiki analyze <entity>` — 分析实体影响
- `codewiki search <query>` — 语义搜索
- `codewiki deps <entity>` — 查看依赖
- `codewiki impact <entity>` — 影响分析
- `codewiki validate <file> <start> <end> <new-content>` — 验证修改安全性
- `codewiki check-accuracy <test-suite>` — 运行准确性测试

### 2.6 人工测试检查程序 — 能力: 0% (需新增)

**需要构建的测试框架：**
- 预定义测试场景（已知正确答案）
- 对比 CodeWiki 辅助 vs 无辅助的修改准确性
- 本体提取正确性验证
- 影响分析完整性验证
- 搜索相关性评分

## 三、CLI 集成设计

### 3.1 架构

```
codewiki-cli (Node.js CLI)
  ├── index — 索引项目，生成 .codewiki/ 缓存
  ├── analyze — 综合分析（本体+影响+搜索）
  ├── search — 语义搜索
  ├── entity — 查询实体信息
  ├── impact — 影响分析
  ├── deps — 依赖图
  ├── validate — 修改前验证
  └── test — 运行准确性测试套件
```

### 3.2 Code Agent 交互流程

```
1. Code Agent 收到修改请求 "添加用户认证中间件"
2. Code Agent 调用: codewiki analyze --query "用户认证" --project /path/to/project
3. CodeWiki 返回:
   - 相关实体: AuthService, UserController, middleware/, routes/
   - 影响范围: 12 个文件, 8 个函数
   - 依赖关系: AuthService → UserRepository → Database
   - 建议修改点: middleware/auth.ts, routes/index.ts
4. Code Agent 调用: codewiki validate --file middleware/auth.ts --start 1 --end 20 --check-deps
5. CodeWiki 返回: 安全，无冲突依赖
6. Code Agent 执行精确修改
7. Code Agent 调用: codewiki impact --entity AuthMiddleware --verify
8. CodeWiki 验证修改后的影响范围是否在预期内
```

### 3.3 输出格式

CLI 支持 `--json` 和 `--human` 两种输出：
- `--json`: 机器可读，供 Code Agent 解析
- `--human`: 人类可读，彩色终端输出

## 四、人工测试检查程序设计

### 4.1 测试类型

| 测试类型 | 目的 | 验证方式 |
|---------|------|---------|
| 本体提取 | 实体是否被正确识别 | 与预期实体列表对比 |
| 关系检测 | 关系是否正确 | 与预期关系对比 |
| 影响分析 | 影响范围是否完整 | 改A应影响B, C但不影响D |
| 搜索质量 | 搜索结果是否相关 | 前5结果中相关结果数 |
| 修改安全性 | 修改验证是否有效 | 故意传错内容应被拒绝 |
| 端到端准确性 | CLI辅助能否提高修改精度 | 对比有无辅助的正确率 |

### 4.2 测试场景示例

```yaml
test_cases:
  - name: "TypeScript class extraction"
    project: test-fixtures/ts-project
    expected_entities:
      - { name: "UserService", type: "Class", file: "services/user.ts" }
      - { name: "getUser", type: "Method", parent: "UserService" }
    expected_relations:
      - { source: "UserService", target: "getUser", type: "contains" }
      - { source: "UserService", target: "Database", type: "imports" }

  - name: "Impact analysis completeness"
    modify_entity: "UserService"
    expected_impacted: ["UserController", "AuthMiddleware", "user.test.ts"]
    not_impacted: ["LogService", "config.ts"]

  - name: "Search relevance"
    query: "database connection"
    expected_top3: ["database.ts", "connection-pool.ts", "db-config.ts"]
```

## 五、可行性结论

| 功能 | 可行性 | 阻塞因素 |
|------|-------|---------|
| CLI 工具 | ✓ 完全可行 | 无，复用现有本体+搜索代码 |
| Code Agent CLI 交互 | ✓ 完全可行 | 需要 JSON 输出格式 |
| 人工测试框架 | ✓ 完全可行 | 需要构建测试 fixtures |
| 本体准确性 80%+ | ✓ 大部分可行 | 复杂泛型/动态调用仍有限 |
| 搜索质量提升 | △ 部分可行 | TF-IDF 无语义理解 |
| 修改回滚 | ✓ 可行 | 已有备份机制 |
| MCP 双向通信 | ✓ 可行 | stdio 已实现 |

**核心结论：CLI 集成是最高优先级，它是连接 Code Agent 和 CodeWiki 的桥梁。人工测试程序是验证准确性的关键。两者都完全可行且可以立即实现。**

## 六、实施计划

1. **CLI 工具** (`cli/codewiki-cli.ts`) — 7 个命令
2. **测试 Fixtures** (`test-fixtures/`) — 预定义项目 + 预期结果
3. **测试运行器** (`cli/test-runner.ts`) — 自动化准确性检查
4. **MCP 增强** — 添加 `suggest_modification` + `validate_modification` 工具
