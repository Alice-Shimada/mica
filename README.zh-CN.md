# MICA

**Mathematica Interactive Control Agent**

简体中文 | [English](README.md)

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-5FA04E?logo=node.js&logoColor=white)
![Bun](https://img.shields.io/badge/runtime-Bun-f3e7d3?logo=bun&logoColor=111111)
![MCP](https://img.shields.io/badge/protocol-MCP-2563eb)
![Wolfram Desktop](https://img.shields.io/badge/Wolfram%20Desktop-14.1%2B-dd1100)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-111827)

MICA 是一个面向 Wolfram Desktop / Mathematica 的本地 MCP 桥接器。它让支持 MCP 的代码 Agent 通过你已经打开的 Notebook 工作：列出 Notebook、检查 cell、插入和编辑代码、运行求值、读取输出与消息、中止长时间计算，并查询 Wolfram Language 文档；整个过程不需要直接写入 `.nb` 文件，也不需要切到脱离 FrontEnd 的 `wolframscript` 工作流。

![MICA architecture hero](docs/assets/mica-readme-hero.png)

## 为什么选择 MICA？

- **直接作用于真实 Notebook**：Agent 操作的是 Wolfram Desktop 中可见的 Notebook，而不是一个分离的 headless kernel。
- **Agent 的工作对人可见**：插入的代码、输出、消息和编辑都会出现在 Notebook 里，方便你检查。
- **Notebook-aware targeting**：Agent 可以列出已打开的 Notebook，选择目标 Notebook，并为会修改 Notebook 的工具启用严格目标选择。
- **面向 Agent 的协议设计**：`mma_status`、`mma_list_notebooks`、结构化错误、有界输出、artifact 分页，以及 `mica_notebook_workflow` prompt 会告诉 Agent 如何安全推进。
- **显式权限控制**：读取、插入、修改、删除、运行和保存权限都显式配置。
- **本地优先的安全模型**：桥接服务绑定到 `127.0.0.1`，使用生成的 bearer token，不提供远程访问模式。
- **面向发布的安装路径**：安装和卸载可逆，并会为 `Kernel/init.m` 创建带时间戳的备份。

## 为什么通过已经打开的 Notebook 工作？

传统自动化通常会把代码复制到独立脚本中，或者启动 headless kernel。这对批处理任务很有用，但会丢失 Notebook 本身的上下文。MICA 让 Agent 留在你正在使用的同一个 FrontEnd 工作流里。

- **保留实时上下文**：已有定义、前面的 cell、富输出、消息和 Notebook 结构都留在真实工作 Notebook 中。
- **人始终在回路中**：你可以看到 Agent 插入了什么，手动中断长时间求值，自己编辑 cell，或者手动重新运行某段内容。
- **更容易审计**：代码执行发生在 Notebook cell 中，而不是不可见的 raw-eval 端点中；Notebook 会留下可见的 cell 和输出。
- **减少上下文损失**：Agent 可以先读取附近的 cell、输出和消息，再决定下一步怎么做。
- **支持多个 Notebook**：Agent 可以发现已打开的 Notebook，并通过当前 `notebookId` 或显示名称定位目标。
- **适合探索式 Wolfram 工作**：图形、动态输出、格式化 box，以及 FrontEnd Notebook 操作都仍然是工作流的一部分。

## 工作方式

```text
MCP client / coding agent
        |
        | stdio MCP
        v
MICA MCP server + localhost dashboard
        |
        | HTTP queue on 127.0.0.1:19791
        v
Hidden Wolfram FrontEnd control agent
        |
        | NotebookRead / NotebookWrite / Cells / CellObject
        v
Your already-open Mathematica notebook
```

隐藏的 Wolfram Agent 运行在专用的 `MMAAgentControl` FrontEnd evaluator 中。你的普通 Notebook 继续使用自己的 evaluator；MICA 负责保持轮询、队列、超时处理和中止请求的响应性。

## 环境要求

| 要求 | 说明 |
| --- | --- |
| Wolfram Desktop / Mathematica | 支持 14.1+。13.x / 14.0 为 experimental（可能可用，但未正式测试）。Headless Wolfram Engine 不支持 live Notebook 控制。 |
| Node.js | 20 或更新版本。 |
| Bun | 可选。用于 Bun 开发脚本。发布版 CLI 通过 Node 运行。 |
| MCP client | Codex、Claude Desktop、Cursor，或任何 stdio MCP client。 |

## 快速开始

从发布版 checkout 开始：

```bash
git clone https://github.com/Alice-Shimada/mica.git
cd mica
npm ci
npm run build
node dist/src/cli/index.js install
```

然后完全退出并重启 Wolfram Desktop。打开一个 Notebook，启动 MCP server，并连接你的 MCP client：

```bash
node dist/src/cli/index.js start
```

如果 MICA 已经安装在你的 `PATH` 中，也可以使用等价的发布版命令：

```bash
mica install
mica start
mica doctor
```

Dashboard：

```text
使用 MICA server 打印的 `Dashboard: http://127.0.0.1:<port>/#token=<token>` URL。
```

Dashboard 使用 token gate：直接打开 `/` 不会获取或显示桥接数据。使用打印出的 token URL 时，它会按 Server、Security、Agents、Notebooks 和 Requests 分组展示诊断信息。点击 Agents 或 Notebooks 可以在概览卡片下方打开共享详情面板。

安装器只会编辑当前用户的 Wolfram `Kernel/init.m`，创建带时间戳的备份，并打印 MCP client 配置片段。它不会编辑系统级 Wolfram 文件，也不会替你编辑 MCP client 配置。

Dry run 和卸载：

```bash
node dist/src/cli/index.js install --dry-run
node dist/src/cli/index.js uninstall
```

兼容用的 legacy 安装入口仍然可用：`node scripts/install.js --dry-run`。

## MCP Client 配置

使用本地 checkout 中构建后的发布版入口：

```toml
[mcp_servers.mica]
command = "node"
args = ["/absolute/path/to/mica/dist/src/cli/index.js", "start"]
```

开发时也可以让 MCP client 指向 TypeScript 入口：

```toml
[mcp_servers.mica]
command = "npx"
args = ["tsx", "/absolute/path/to/mica/src/bun/index.ts"]
```

## Agent Guide Prompt

MICA 在两个 MCP-facing 位置暴露使用指导：

- Server initialization `instructions`
- 可复用 prompt：`mica_notebook_workflow`

这个 prompt 会要求 Agent 从 `mma_status` 或 `mma_list_notebooks` 开始，使用当前的 `notebookId`，避免操作隐藏或离屏 Notebook，避免用 detached `wolframscript` 调试 live Notebook，并处理结构化的 `ok: true` / `ok: false` 响应。

## 工具

| Tool | 用途 |
| --- | --- |
| `mma_status` | 报告 server、agent 和 Notebook registry 状态。 |
| `mma_list_notebooks` | 列出已注册的 live Notebook 和 active notebook id。 |
| `mma_select_notebook` | 通过 `notebookId` 或无歧义的 `displayName` 选择 active Notebook。 |
| `mma_symbol_lookup` | 查询 Wolfram Language 的 usage、options、attributes 和文档 URL。 |
| `mma_list_cells` | 列出所选 Notebook 中的 cell。 |
| `mma_read_cell` | 读取单个 cell 的内容和 metadata。 |
| `mma_insert_cell` | 插入 cell；使用 `afterCellId="__end__"` 可以追加到末尾。 |
| `mma_modify_cell` | 修改已有 cell。 |
| `mma_delete_cell` | 删除已有 cell。 |
| `mma_run_cell` | 在 timeout 限制下求值一个 cell。 |
| `mma_abort_evaluation` | 中止当前 Notebook 求值。 |
| `mma_get_cell_output` | 读取 cell 的输出和消息。 |
| `mma_read_artifact` | 按 byte page 读取大输出或大消息 artifact。 |
| `mma_save_notebook` | 在授予 `SaveNotebook` 权限时保存 Notebook。 |

所有 MCP 工具都会返回 JSON text 和 `structuredContent`。

```json
{ "ok": true, "result": "..." }
```

`mma_read_cell` 默认会截断大的 cell 内容、输出和消息，以保持 MCP 响应有界。`mma_get_cell_output` 会把小输出和消息内联返回，并为大条目返回 artifact metadata；把返回的 `artifactId` 传给 `mma_read_artifact`，并提供 `offset` 和 `limit`，即可分页读取完整文本。Artifact id 是确定性的但短生命周期：它们通过重新扫描当前 Notebook 来解析，所以 Notebook 被编辑或重新运行后，id 可能失效，或者指向更新后的内容。读取输出或 artifact 也可能刷新已完成 cell 的运行状态。输出状态包括 `running`、`abort_requested`、`aborted`、`finished`、`timeout` 和 `unknown`；`abort_requested` 表示 MICA 已发送中止信号，但还没有观察到终态完成。可以传入 `maxBytes`（正整数，最大 1 MiB）来请求不同的响应预算。截断或 artifact-backed 响应会包含 `truncated`、`originalByteLength` 和 `returnedByteLength` metadata。

预期内失败会被结构化，并设置 MCP `isError` flag：

```json
{
  "ok": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "The selected notebook did not grant permission for this tool.",
    "retryable": false,
    "tool": "mma_save_notebook"
  }
}
```

## 手动启动 Wolfram 侧桥接

如果你不想编辑 `Kernel/init.m`，可以启动 Wolfram Desktop，并在替换路径后求值以下代码：

```wolfram
Get["/absolute/path/to/mica/paclet/Kernel/MMAAgentBridge.wl"];
MMAAgentBridge`Private`$BridgePermissions = <|
  "ReadNotebook" -> True,
  "InsertCell" -> True,
  "ModifyCell" -> True,
  "DeleteCell" -> True,
  "RunCell" -> True,
  "SaveNotebook" -> False
|>;
MMAAgentBridge`StartMMAAgentControlKernel[]
```

## 开发

```bash
npm test
npm run typecheck
npm run build
npm run dev:mcp
npm run dev:bridge
```

常用命令：

| Command | 用途 |
| --- | --- |
| `npm run dev:mcp` | 通过 `tsx` 启动 TypeScript MCP server。 |
| `npm run dev:bridge` | 启动 TypeScript bridge 和 dashboard，不启用 stdio MCP。 |
| `npm run dev:bun:mcp` | 通过 Bun 启动 MCP server。 |
| `npm run dev:bun` | 通过 Bun 启动 bridge 和 dashboard，不启用 stdio MCP。 |
| `npm run dev:legacy` | 启动 legacy Node HTTP bridge，用于 Palette 兼容性测试。 |
| `npm run build` | 在 `dist/` 下输出生产 JavaScript。 |

## 验证清单

```bash
npm test
npm run typecheck
npm run build
node dist/src/cli/index.js install --dry-run
node dist/src/cli/index.js doctor
```

Live smoke test：

1. 运行 `node dist/src/cli/index.js install`。
2. 完全重启 Wolfram Desktop。
3. 打开一个 Notebook。
4. 确认 `mma_status` 报告 online agent 和已注册 Notebook。
5. 确认 insert、read、modify、run、get-output、delete、abort 和 symbol lookup 都能作用于该 Notebook。
6. 运行 `node dist/src/cli/index.js uninstall`，并确认 `Kernel/init.m` 中标记的 block 已被移除。

另见：

- [Manual Smoke Test](docs/qa/manual-smoke-test.md) — 完整发布检查清单。
- [Support Matrix](docs/qa/support-matrix.md) — 平台和运行时覆盖情况。

## Troubleshooting

优先运行内置 doctor；它会无副作用地诊断最常见问题：

```bash
node dist/src/cli/index.js doctor
# 或者，如果已经全局安装：
mica doctor
```

Doctor 会检查 Node 版本、package build、session file、auth token、server 可达性、live agent/notebook 数量、Wolfram user base、`Kernel/init.m` 和 MICA autoload block。每项检查都会报告 `OK` 或 `FAIL`，并给出建议的 `FIX` 行。

**常见失败与修复：**

| Doctor output | 可能原因 | 操作 |
| --- | --- | --- |
| `FAIL Session file` | Server 尚未启动 | `mica start` |
| `FAIL Auth token` | Token 不匹配或已过期 | 重启 server |
| `FAIL Server /status reachable` | Server 未运行 | `mica start` |
| `FAIL Live agent count: 0` | Wolfram 未运行或 bridge 未加载 | 安装后重启 Wolfram Desktop |
| `FAIL Live notebook count: 0` | 没有打开或注册的 Notebook | 在 Wolfram Desktop 中打开 Notebook |
| `FAIL Kernel/init.m` | 尚未运行安装器 | `mica install` |
| `FAIL Autoload block` | 尚未安装或已卸载 | `mica install` |
| `FAIL Package build` | 缺少 build artifacts | `npm run build` |

如果 doctor 通过，但 MCP client 中仍看到 `NO_LIVE_AGENT`、`NOTEBOOK_STALE` 或连接错误，请完全退出并重启 Wolfram Desktop，然后重启 MICA server。

## 安全模型

- MICA 将 HTTP bridge 绑定到 `127.0.0.1`。
- MICA 会写入包含生成 auth token 的本地 session file，并要求 protocol endpoints 使用 `Authorization: Bearer <token>`。
- Dashboard token 放在 URL fragment（`#token=...`）中，而不是 HTTP request path 中。
- Dashboard URL（包含本地 bearer token）会打印到当前用户会话的 server startup log。
- MICA 不提供远程访问模式。
- MICA 不包含任意 shell 工具，也没有直接 raw-eval MCP endpoint。
- Notebook 修改通过 Wolfram FrontEnd API 和显式权限完成。
- 安装器权限 block 默认禁用 `mma_save_notebook`。
- Node/Bun 进程不会直接编辑 `.nb` 文件。

## 显式 Notebook Targeting

设置 `MICA_STRICT_TARGETING=1` 后，所有会修改 Notebook 的 MCP 工具（`mma_insert_cell`、`mma_modify_cell`、`mma_delete_cell`、`mma_run_cell`、`mma_abort_evaluation`、`mma_save_notebook`）都必须显式提供 `notebookId`（或 `displayName`）。只读 Notebook 工具（`mma_list_cells`、`mma_read_cell`、`mma_get_cell_output`）仍然使用 active Notebook，`mma_symbol_lookup` 不受影响，因为它不针对某个 Notebook。启用 strict targeting 后，如果未提供 selector，工具会返回 error code `EXPLICIT_NOTEBOOK_REQUIRED`，并设置 `retryable: false`。默认行为（未设置 env var，或值不是 `"1"`）保持不变。

## 已知限制

- 当 Wolfram kernel 已经繁忙时，取消操作是 best-effort。
- Cell id 是 session-local 的，重新打开 Notebook 后可能变化。
- FrontEnd Notebook 操作目前是串行化的。
- Legacy Palette flow 仅保留用于迁移期兼容；文档化的发布路径是 CLI + MCP server。

## License

MIT — 见 [LICENSE](LICENSE)。
