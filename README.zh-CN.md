# weixin-plugin-cc

[![English](https://img.shields.io/badge/README-English-blue)](README.md)

Claude Code 微信频道插件 — 通过 MCP 将微信消息桥接到 Claude Code。

## 功能

- **扫码登录** — 扫码登录，会话自动保存和恢复
- **长轮询消息投递** — 实时微信消息桥接
- **媒体支持** — 收发图片、视频、文件（最大 50MB）
- **访问控制** — 配对模式（默认）、白名单、禁用
- **自动分片** — 长回复按微信 ~2048 字符限制自动拆分
- **权限中继** — 在微信中审批 Claude Code 的工具权限请求
- **输入状态** — 处理消息时显示正在输入

## 安装

在 Claude Code 中添加 marketplace：

```
/plugin marketplace add kkk0913/weixin-plugin-cc
```

安装插件：

```
/plugin install weixin@weixin-plugin-cc
```

重新加载插件。

> **注意：** 这是一个频道插件，必须使用开发频道标志启动 Claude Code：
>
> ```
> claude --dangerously-load-development-channels plugin:weixin@weixin-plugin-cc
> ```
>
> 不加此标志，微信消息将无法投递到 Claude Code。

## 首次使用

1. 运行 `/weixin:configure` 检查状态
2. 运行 `/weixin:configure login`，然后 `/reload-plugins` 重启服务
3. 服务会输出一个浏览器登录链接，在浏览器中打开并用微信扫码（8 分钟内有效）
4. 会话保存在 `~/.claude/channels/weixin/account.json`

### 会话过期

会话过期时，服务会停止轮询并记录错误码。执行：

```
/weixin:configure clear
/weixin:configure login
```

然后 `/reload-plugins` 重新扫码登录。

## 访问控制

新微信用户默认需要配对：

1. 未知用户发送消息
2. 服务生成 6 位配对码并回复给用户
3. 在 Claude Code 中执行：`/weixin:access pair <code>`
4. 用户被添加到白名单

模式（配置在 `~/.claude/channels/weixin/access.json`）：

| 模式 | 行为 |
|------|------|
| `pairing` | 新用户获得配对码（默认） |
| `allowlist` | 仅白名单用户可发消息 |
| `disabled` | 丢弃所有消息 |

## Skills

| Skill | 说明 |
|-------|------|
| `/weixin:configure` | 检查状态、登录、清除会话 |
| `/weixin:access` | 管理访问控制（配对、添加、移除、策略） |

## MCP 工具

| 工具 | 说明 |
|------|------|
| `reply` | 发送文本和附件给微信用户 |
| `react` | 不支持（微信无表情回应功能） |
| `download_attachment` | 下载消息中的媒体文件到本地 |
| `edit_message` | 发送新消息替代（微信无编辑功能） |

## 项目结构

```
src/
├── server.ts              # MCP 服务、轮询循环、消息路由
├── config/
│   └── access.ts          # 访问控制（配对/白名单/禁用）
├── weixin/
│   ├── api.ts             # 微信 iLink Bot API 客户端
│   ├── types.ts           # TypeScript 类型定义
│   ├── crypto.ts          # AES-128-ECB CDN 媒体加解密
│   └── media.ts           # 媒体文件上传/下载
└── util/
    └── helpers.ts         # 工具函数

skills/
├── access/
│   └── SKILL.md           # 访问控制 skill
└── configure/
    └── SKILL.md           # 配置和登录 skill
```

## 状态目录

`~/.claude/channels/weixin/` 存储：

- `account.json` — 登录会话（token、用户 ID、Bot ID）
- `access.json` — 访问控制配置
- `inbox/` — 下载的媒体文件

## 许可证

MIT
