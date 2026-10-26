# AI 自动判定（决策模型）设计与使用说明

> 对应实现：`packages/obsidian-plugin/src/runtime/decision.ts`、`src/decision-modal.ts`
> 状态：已实现并经真实 Obsidian + 本地 mock 服务端到端验证

---

## 一、这个功能解决什么问题

原来的治理模型是**全人工**：

```
Agent 提交候选卡 → 全部进入「待审」队列 → 人工逐张判断 → 晋升 / 归档
```

问题不在于"人工不可靠"，而在于**人工是瓶颈**：Agent 每小时提交几十张卡，人工根本审不过来，队列越积越长，最后要么全批要么不看。

目标变成**分级判定**：

```
Agent 提交候选卡
        ↓
   硬性治理规则（确定性，永远优先，模型无法绕过）
        ↓
   决策模型判定（可判定 + 高置信度 → 自动处理）
        ↓
   判定不了 / 不确定 → 转人工审阅（带模型理由，人只看这些）
```

**关键设计原则：模型只负责"模型能负责的部分"，硬规则永远优先。** 这与仓库里审计出的 H1 问题（晋升时信任卡片自报的 `governance_score`）是同一个教训：任何"最终裁决"都不能来自被裁决内容自己。

---

## 二、模型选型建议

### 推荐主选：阿里云百炼 `decision-model-preview`

理由（按重要性）：

1. **它原生返回概率分布与置信度**，这正是"自动处理 vs 转人工"这道闸门需要的信号。通用对话模型给的"置信度"是自我报告的标量，可靠性差一个档次。
2. **问题类型与治理维度一一对应**，不需要把治理规则硬塞进自然语言提示词：
   - `noul`（是/否）→ 能否晋升、是否需人工复核
   - `score`（评分）→ 质量分
   - `choice`（分类）→ 知识类型（事实/决策/方法/资料）
3. **接口是 OpenAI 兼容风格**（`/compatible-mode/v1/systemone`），不需要引入专用 SDK。

已验证的调用形态（插件实际发出的请求）：

```jsonc
POST <endpoint>
{
  "model": "decision-model-preview",
  "state": {
    "title": "...", "content": "...", "tags": [...], "source": "...",
    "governance_score": 92, "declared_confidence": "high",
    "sensitivity": "internal", "status": "review"
  },
  "questions": {
    "promotable":          { "type": "noul",   "instructions": "内容是否准确、完整、可作为长期正式知识直接复用？..." },
    "quality":             { "type": "score",  "instructions": "...", "criteria": ["很可能出错…", "存在明显疑点…", "基本可靠…", "高度可信…"] },
    "category":            { "type": "choice", "instructions": "这条知识属于哪一类？", "criteria": { "fact": "...", "decision": "...", "procedure": "...", "reference": "..." } },
    "needs_human_review":  { "type": "noul",   "instructions": "是否必须人工复核后才能进入正式知识库？..." }
  }
}
```

### 备选：任意 OpenAI 兼容的对话模型

插件同时支持 `openai-compatible` 模式，填到 `/chat/completions` 即可，可直接用：

| 选项 | 说明 |
| --- | --- |
| 通义千问 `qwen-plus` / `qwen-max` | 阿里云同门，兼容模式最省事 |
| DeepSeek / 智谱 GLM / Kimi | 均有 OpenAI 兼容端点 |
| 本地 Ollama / LM Studio | 完全离线，适合敏感知识库；代价是判定质量下降，阈值要调高 |

这种模式下插件用严格 JSON 提示词要求返回：

```json
{ "promotable": true, "promotable_confidence": 0.91, "quality_score": 88,
  "needs_human_review": false, "category": "decision", "reason": "..." }
```

**建议**：用决策模型做主力（置信度信号更可靠），用 OpenAI 兼容模式做兜底/私有化部署。

---

## 三、真实接口的返回结构（实测，重要）

`decision-model-preview` 的返回**不是**普通的对话 JSON，答案全部在 `answers` 下，且三种问题类型的值形态完全不同：

```jsonc
{
  "model": "decision-model-preview",
  "request_id": "8968b62a-…",
  "answers": {
    // noul：数值是"是"的概率（0..1），不是布尔值
    "promotable":         { "type": "noul",   "noul": 0.94 },
    // score：score 是该刻度上的期望值，legend 把下标映射成文字
    "quality":            { "type": "score",  "score": 1.71,
                            "legend": { "0": "很可能出错", "1": "存在疑点", "2": "基本可靠", "3": "高度可信" },
                            "probabilities": { "0": 0.26, "1": 0.04, "2": 0.42, "3": 0.27 },
                            "confidence": 0.72 },
    // choice：choice 是选中的标签，probabilities 是完整分布
    "category":           { "type": "choice", "choice": "fact", "confidence": 0.49,
                            "probabilities": { "fact": 0.62, "decision": 0.36, "procedure": 0, "reference": 0.02 } },
    "needs_human_review": { "type": "noul",   "noul": 0.03 }
  },
  "usage": { "input_tokens": 160 },
  "latency_ms": 55.7
}
```

三点必须注意：

1. **`noul` 的值是概率，不是布尔。** `promotable: 0.51` 表示"可晋升"只有五成把握——**不能**当成 `false`，更不能当成"否"。这正是自动/转人工闸门需要的信号。
2. **`score` 是刻度上的期望值，不是百分制。** `score: 1.71` 配 4 档 legend（0..3）→ 换算成百分制是 `1.71 / 3 × 100 ≈ 57`。
3. **接口不返回任何自然语言理由。** 插件用原始数字合成一句人话，例如：
   `可晋升概率 94%，质量分 90，需人工复核概率 3%，分类 fact`。

> 踩坑记录：归一化函数最初按"通用 JSON"写，结果把 `noul` 当布尔、把 `score` 当百分制、把 `choice` 当对象。**表现是 100% 的卡片都判成"转人工"**（因为可晋升概率被读成 0）。是接真实端点跑一轮才发现的——单元测试用的 mock 结构太"干净"，掩盖了这个问题。现在已按真实载荷补了 7 项回归测试。

---

## 四、判定闸门（模型永远无法绕过）

`planAutoAction()` 按固定顺序求值，**硬规则在最前**：

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 硬性规则未通过（status 非法 / 治理分 < 80 / 置信度非 medium·high / 敏感度为 secret） | **转人工**，理由写明是哪条规则没过 |
| 2 | 模型调用失败（网络、HTTP 4xx/5xx、返回不是 JSON） | **转人工**，附错误信息 |
| 3 | 模型明确要求人工复核（`needs_human_review = true`） | **转人工**，附模型理由 |
| 4 | 模型置信度 < 阈值（默认 85%） | **转人工**，附实际置信度与阈值 |
| 5 | 模型判定可晋升 | **自动晋升**（需开启自动晋升且非演练模式） |
| 6 | 模型判定不可晋升 | 转人工；开启自动归档则归档（默认关闭，归档不可逆） |

也就是说：**模型只能决定"剩下那部分里哪些能自动过"，不能放宽任何硬性条件。**

---

## 五、安全设计

### API Key 不进 Vault

| 位置 | 是否使用 | 说明 |
| --- | --- | --- |
| 环境变量（默认 `DASHSCOPE_API_KEY`） | 优先 | 从 `process.env` 读取 |
| `~/Library/Application Support/obsidian-agent-kb/secrets.json` | 兜底 | 权限 `0600`，**在 Vault 之外** |
| `data.json`（插件设置） | ❌ 绝不使用 | 该文件在 Vault 内，会被 Vault 同步或 Git 带走 |

设置页只显示"已保存密钥 / 未找到密钥"，**永不显示密钥内容**。

> 注意：Obsidian 是 GUI 应用，`process.env` 反映的是 Obsidian 启动时的环境，通常**不含** `~/.zshrc` 里的变量。因此实际使用中请依赖"保存密钥"这条路径，或把 Obsidian 用 `launchctl setenv` 启动。

### 审计留痕

每次判定都会追加一行到 `.obsidian/plugins/obsidian-agent-kb/runtime/decisions.jsonl`：

```json
{ "timestamp": "...", "path": "...", "title": "...", "action": "promote|archive|review",
  "reason": "...", "blockers": [...], "provider": "...", "model": "...",
  "confidence": 0.94, "quality_score": 100, "category": "decision",
  "needs_human_review": false, "error": null }
```

自动晋升时还会把 `governance_decision: auto-promoted`、`auto_decision_confidence`、`auto_decision_model`、`auto_decision_reason` 写进卡片 frontmatter，事后可追溯。

### 默认安全姿态

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| 启用 AI 自动判定 | **关** | 开启前所有卡片仍走纯人工 |
| 演练模式 | **开** | 只给建议，绝不改知识库 |
| 自动晋升 | **关** | 需要显式开启 |
| 自动归档 | **关** | 归档不可逆，默认最保守 |
| 新卡片自动判定 | **关** | 开启后 Agent 一提交就跑判定 |
| 置信度阈值 | 0.85 | 低于此值一律转人工 |

**推荐上线顺序**：开启功能 → 保持演练模式跑一周 → 看 `decisions.jsonl` 里模型的实际判断 → 调低/调高阈值 → 再开自动晋升。

---

## 六、界面使用

### 知识审阅页

- **单卡判定**：卡片标题行右侧的 ✨ 按钮（仅在启用后出现）。弹出判定结果弹窗：
  - 结论徽章（绿=可晋升 / 黄=需人工 / 红=不建议）
  - 模型置信度、质量分、知识分类、模型名
  - 判定理由；未通过硬规则时额外列出未通过的规则
  - 操作：`取消` / `立即晋升`（结论为可晋升时）/ `立即归档`
  - **弹窗里的手动操作会绕过演练模式**——人点了就是要做。批量与自动流程则受演练模式约束。
- **批量判定**：面板标题栏的 ✨ 按钮，对当前队列中筛选后的卡片批量判定，受"单次批量上限"限制（默认 20）。
- **新卡片自动判定**：开启后，Agent 提交候选卡时自动跑一次判定；每张卡只判一次。

---

## 七、验证情况

### 真实卡片批量实测（2026-10-25）

用真实 `DASHSCOPE_API_KEY` 对 Vault 里 **24 张旧卡片**跑了一遍全量判定（演练模式，知识库零改动）：

| 结论 | 数量 | 说明 |
| --- | --- | --- |
| 可自动晋升 | 19 | 置信度 0.86–0.95，质量分 84–90，分类以 `fact` 为主（20 张 fact / 3 procedure / 1 decision） |
| 转人工 | 5 | 见下 |

转人工的 5 张，模型的理由很准——**全是带"未决 / 冲突 / 待修"语义的卡片**：

| 卡片 | 置信度 | 质量分 | 模型判断 |
| --- | --- | --- | --- |
| oakb-mcp 调用方必须显式声明 Agent 身份 | 0.79 | 84 | 低于阈值 85% |
| Obsidian Agent KB HTTP 端点存在身份合规冲突 | 0.79 | 84 | 低于阈值 85% |
| ZCode HTTP 通道合规但 stdio 网关仍是首选 | 0.67 | 80 | 低于阈值 85% |
| obsidian-agent-kb 接入注册表与文档路径存在两处待修 | 0.43 | 35 | 低于阈值 85% |
| 遗留共享 token 与注册表治理待裁决 | 0.41 | 45 | 低于阈值 85% |

这正是设计目标：事实性的迁移记录被放行，带未决治理项与合规冲突的卡被拦下来给人看。

**演练模式验证**：判定后 `03-knowledge/reviewed/` 仍为 24 张、`canonical/` 仍为 0 张、没有任何卡片被写入 `governance_decision: auto-promoted`——确认未改动知识库。

### 自动化测试

- **单元测试 21 项**（`src/runtime/decision.test.ts`）：请求体结构、两种 provider 的归一化、围栏 JSON 容错、四道闸门的优先级、演练模式语义、HTTP 错误与网络失败、API Key 只出现在 `Authorization` 头而不出现在请求体。
- **端到端（mock）**：用本地 mock 服务模拟百炼决策接口，在真实 Obsidian 1.14.5 中验证
  - 请求体确实包含 `state`（8 个字段）与 `questions`（4 个问题）；
  - `Authorization: Bearer …` 头存在；
  - 弹窗正确显示"可晋升为正式知识 / 置信度 94% / 质量分 100 / 分类 decision"；
  - 批量判定按上限处理并给出演练模式提示，知识库未被修改。
- **端到端（真实端点）**：用真实密钥跑通 24 张卡片，结果见上表。

---

## 八、尚未覆盖

- **自动晋升尚未在真实 Vault 上执行过**：24 张卡片的判定全部在演练模式下完成，模型认为其中 19 张够格自动晋升，但知识库仍是零改动。建议先在测试 Vault 里开一次自动晋升验证写入路径（frontmatter 标记 + 文件移动），再在正式 Vault 打开。
- **自动归档路径未验证**（默认关闭，归档不可逆）。
- 判定记录目前只写 JSONL，没有签名/哈希链——与审计报告里 H5 是同一类问题，优先级排在审计报告的 P1。
- 阈值 0.85 是默认值，来自本轮 24 张卡的实际分布（可晋升组 0.86–0.95，转人工组 0.41–0.79，两组之间有清晰间隔）。但 24 张样本偏小，且都是同一类迁移记录，**换一批内容后应重新看分布再定阈值**。
