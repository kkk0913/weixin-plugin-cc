# weixin-plugin-cc-cx

[![English](https://img.shields.io/badge/README-English-blue)](README.md)

Claude Code / Codex 微信桥接器。

`cc-cx` 指的是 `Claude Code` 和 `Codex`。

> **致谢：** 本项目主要由 **MiMo-Pro** 和 **Kimi-2.5** 联手打造，**Opus** 负责最后的校准优化——也就是那个在代码写完之后才姗姗来迟、皱着眉头说"嗯，让我来调一下"的质检员。至于 Codex 桥接这一段，主要是由 **Codex** 本人亲自接线完成的；毕竟让别人一直假装自己是 Codex，这件事多少开始显得有点尴尬了。可以理解为两个充满干劲的实习生写完了大部分应用，一位资深架构师坐在舒适的椅子上做 code review，而 Codex 则在最后进门，把自己的延长线接好。最终成果？一个出人意料能用的微信桥接插件——尽管他们当中的大多数还是没有微信号。

## 功能

- **扫码登录** — 扫码登录，会话自动保存和恢复
- **长轮询消息投递** — 实时微信消息桥接
- **媒体支持** — 收发图片、视频、文件（最大 50MB）
- **访问控制** — 配对模式（默认）、白名单、禁用
- **自动分片** — 长回复按微信 ~2048 字符限制自动拆分
- **权限中继** — 在微信中审批 Claude Code 的工具权限请求
- **输入状态** — 处理消息时显示正在输入
- **Codex 后端** — 可选的 `codex app-server` 独立桥接模式

## 安装

现在已经不支持“只安装 cc 插件、不运行本地仓库 daemon”的单独插件模式。必须先把仓库 clone 到本地并启动 daemon，再让 Claude Code 连接。

### 1. 先 clone 仓库并启动 daemon

先把仓库拉到本地：

```bash
git clone https://github.com/kkk0913/weixin-plugin-cc-cx.git
cd weixin-plugin-cc-cx
```

从本地仓库启动 daemon：

```bash
npm run start
```

可选环境变量既可以通过 shell 传入，也可以写在项目根目录的 `.env` 文件里。示例见 [.env.example](/home/demon/workspace/weixin-plugin-cc-cx/.env.example)。

可选环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WEIXIN_STATE_DIR` | `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx` | 会话、路由、socket、缓存、inbox 的状态目录 |
| `WEIXIN_CLAUDE_CONFIG_DIR` | `~/.claude` | Claude 本地配置目录，用于读取 `.credentials.json` 和 `stats-cache.json` |
| `WEIXIN_CODEX_CWD` | 当前工作目录 | 传给 `codex -C ... app-server` 的工作区 |
| `WEIXIN_CODEX_MODEL` | 未设置 | 覆盖 Codex 模型 |
| `WEIXIN_CODEX_APPROVAL_POLICY` | `on-request` | Codex 审批策略 |
| `WEIXIN_CODEX_SANDBOX` | `workspace-write` | Codex 沙箱模式 |
| `WEIXIN_CODEX_COMMAND` | `codex` | Codex CLI 可执行文件 |

`WEIXIN_CLAUDE_CONFIG_DIR` 只用于读取本地 Claude 文件，例如 `.credentials.json` 和 `stats-cache.json`。Claude Code 本身仍然是通过 daemon 管理的本地 proxy/socket 连接。

示例：

```bash
WEIXIN_STATE_DIR=/path/to/state WEIXIN_CLAUDE_CONFIG_DIR=/home/me/.claude-official WEIXIN_CODEX_CWD=/path/to/repo WEIXIN_CODEX_MODEL=gpt-5.4 npm run start
```

### 2. 再连接 Claude Code

在 Claude Code 中添加 marketplace：

```text
/plugin marketplace add kkk0913/weixin-plugin-cc-cx
```

安装插件：

```text
/plugin install weixin@weixin-plugin-cc-cx
```

重新加载插件。

使用开发频道标志启动 Claude Code：

```bash
claude --dangerously-load-development-channels plugin:weixin@weixin-plugin-cc-cx
```

Claude 插件进程现在不会自己轮询微信，只负责通过本地 socket 把 Claude 的 MCP channel 转发给你从本地仓库启动的 daemon。

## 首次使用

启动和登录优先使用 npm 脚本。cc skill 仍可用，但作为次选入口。

1. 先运行 `npm run start` 启动守护进程
2. 用 `npm run status` 检查当前状态
3. 用 `npm run login` 触发登录
4. 如果 Claude Code 需要重连本地代理，再执行 `/reload-plugins`
5. 守护进程会输出一个浏览器登录链接，在浏览器中打开并用微信扫码（8 分钟内有效）
6. 默认保存在 `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/account.json`，如果设置了 `WEIXIN_STATE_DIR` 则保存在该目录下

等价的可选 cc skill 入口：

```bash
/weixin:configure
/weixin:configure login
```

常用 CLI 命令：

```bash
npm run status
npm run relogin
npm run clear
npm test
```

### 会话过期

会话过期时，服务会停止轮询并记录错误码。执行：

```
npm run clear
npm run login
```

如果 Claude Code 需要重连，再执行 `/reload-plugins`。`/weixin:configure clear` 和 `/weixin:configure login` 仍可用，但推荐优先走 npm。

## 访问控制

新微信用户默认需要配对：

1. 未知用户发送消息
2. 服务生成 6 位配对码并回复给用户
3. 在终端中批准：`/weixin:access pair <code>`
4. 用户被添加到白名单

模式（默认配置在 `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/access.json`）：

| 模式 | 行为 |
|------|------|
| `pairing` | 新用户获得配对码（默认） |
| `allowlist` | 仅白名单用户可发消息 |
| `disabled` | 丢弃所有消息 |

## 后端切换

每个微信聊天都会记住当前后端，直到再次切换。

| 消息 | 效果 |
|------|------|
| `/claude` | 后续消息转发给 Claude Code |
| `/cc` | 等同于 `/claude` |
| `/codex` | 后续消息转发给 Codex |

为避免和普通对话混淆，后端切换现在只识别带 `/` 的显式命令。

## Skills

这些 skill 只是可选快捷入口，不是主流程。对于启动、登录、重登录、清理会话、状态检查，优先使用上面的 npm 脚本。

| Skill | 说明 |
|-------|------|
| `/weixin:configure` | 状态/登录/清理的可选快捷入口；优先使用 `npm run status/login/relogin/clear` |
| `/weixin:access` | 管理访问控制（配对、添加、移除、策略） |

## MCP 工具

| 工具 | 说明 |
|------|------|
| `reply` | 发送文本和附件给微信用户 |
| `react` | 不支持（微信无表情回应功能） |
| `download_attachment` | 下载消息中的媒体文件到本地 |
| `edit_message` | 发送新消息替代（微信无编辑功能） |

## 流程图

```text
WeChat User
    |
    v
WeChat API
    |
    v
weixin-plugin-cc-cx daemon
  polling
    -> inbound-router
    -> state/config
    -> backend adapters
         |- Claude Path -> claude proxy -> Claude Code
         `- Codex Path  -> codex bridge -> codex app-server
```

## 项目结构

维护者架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

```
server.ts                  # 统一入口：终端里跑 daemon，插件模式下做 Claude 本地代理

src/
├── claude/
│   └── proxy.ts           # Claude MCP stdio 代理 -> 本地 daemon socket
├── codex/
│   ├── app-server.ts      # Codex app-server JSON-RPC 客户端
│   ├── approval-manager.ts # Codex 审批状态管理
│   ├── bridge.ts          # WeChat <-> Codex 线程桥接
│   ├── server-request-handler.ts # Codex 服务器请求处理
│   ├── thread-manager.ts  # Codex 对话线程生命周期
│   ├── turn-state.ts      # Codex 回合跟踪
│   └── types.ts           # 精简的 Codex 协议类型
├── config/
│   ├── access.ts          # 访问控制（配对/白名单/禁用）
│   ├── backend-route.ts   # 按聊天记录后端路由
│   └── poll-owner.ts      # 单消费者轮询租约
├── ipc/
│   ├── client.ts          # Claude 本地代理到 daemon 的客户端
│   ├── protocol.ts        # 本地 IPC 消息协议
│   └── wire.ts            # JSON lines socket 封包
├── runtime/
│   ├── daemon.ts          # 顶层装配与启动流程
│   ├── backend-manager.ts # 后端可用性与 Codex bridge 生命周期
│   ├── backends.ts        # Claude/Codex 后端适配器
│   ├── bridge-server.ts   # 插件模式下的桥接 HTTP 服务器
│   ├── claude-activity-provider.ts # Claude 输入状态提供者
│   ├── claude-config.ts   # Claude 配置辅助
│   ├── claude-usage-provider.ts # Claude 用量统计提供者
│   ├── codex-rate-limit-provider.ts # Codex 速率限制跟踪
│   ├── command-parser.ts  # 后端切换和 stats 命令解析
│   ├── command-service.ts # 命令执行编排
│   ├── command-text.ts    # 命令响应文本格式化
│   ├── env.ts             # 环境变量辅助
│   ├── inbound-parser.ts  # 入站消息分类
│   ├── inbound-router.ts  # 已解析入站事件的分发器
│   ├── lifecycle.ts       # 退出和信号处理
│   ├── login.ts           # 扫码登录与重登录流程
│   ├── paths.ts           # 共享运行时路径
│   ├── polling-service.ts # 带 cursor 的轮询包装
│   ├── polling.ts         # 长轮询主循环
│   ├── session-state.ts   # 进程内 TTL 状态
│   ├── state-dir.ts       # 状态目录解析
│   ├── stats-format.ts    # 统计格式化辅助
│   ├── stats-service.ts   # Claude/Codex 统计聚合
│   ├── system-message-service.ts # 系统消息组装
│   └── tool-handlers.ts   # MCP 工具执行与权限转发
├── state/
│   ├── json-file.ts       # 通用 JSON 文件持久化帮助类
│   ├── access-repository.ts
│   ├── account-repository.ts
│   ├── backend-route-repository.ts
│   ├── codex-thread-repository.ts
│   ├── cursor-repository.ts
│   ├── flag-file.ts
│   ├── login-trigger-repository.ts
│   └── usage-cache-repository.ts
├── weixin/
│   ├── api.ts             # 微信 iLink Bot API 客户端
│   ├── types.ts           # TypeScript 类型定义
│   ├── crypto.ts          # AES-128-ECB CDN 媒体加解密
│   ├── inbound.ts         # Claude/Codex 入站载荷预处理
│   └── media.ts           # 媒体文件上传/下载
└── util/
    └── helpers.ts         # 工具函数

test/
├── codex/
│   └── bridge.test.ts
├── config/
│   ├── access.test.ts
│   ├── backend-route.test.ts
│   └── poll-owner.test.ts
├── runtime/
│   ├── command-parser.test.ts
│   ├── inbound-parser.test.ts
│   ├── inbound-router.test.ts
│   └── session-state.test.ts
└── weixin/
    └── inbound.test.ts

skills/
├── access/
│   └── SKILL.md           # 访问控制 skill
├── configure/
│   └── SKILL.md           # 配置和登录 skill
└── permission/
    └── SKILL.md           # 权限管理模式 skill
```

## 状态目录

默认存储目录是 `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/`
如果设置了 `WEIXIN_STATE_DIR`，则使用该目录：

- `account.json` — 登录会话（token、用户 ID、Bot ID）
- `access.json` — 访问控制配置
- `backend-route.json` — 按聊天记录保存的 Claude/Codex 路由
- `codex-threads.json` — 微信用户到 Codex thread 的映射（Codex 模式）
- `.cursor` — 微信长轮询 cursor
- `.usage-cache.json` — Claude 用量缓存
- `.auto-approve` — 会话级审批开关
- `daemon.sock` — Claude 本地代理和 daemon 之间的 IPC socket
- `poll-owner.json` — 当前轮询拥有者租约
- `inbox/` — 下载的媒体文件

## 开发

```bash
npm run typecheck
npm test
npm run build
```

## 许可证

MIT
