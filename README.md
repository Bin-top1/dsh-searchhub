# 🔍 dsh-searchhub

<details>
<summary><b>🇨🇳 中文说明（点击展开完整中文文档）</b></summary>

<br>

### 别再为 Agent 的联网搜索花钱了

**dsh-searchhub** 是给 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 用的**可插拔搜索中枢**。它让你的 Agent 通过市面主流、即插即用的搜索服务商（挂在 DSH 的 web 能力接缝 `ctx.web` 后面）来联网搜索，而**不用每次 `web_search` 都消耗付费的 DeepSeek 模型调用**。

> 💸 **不用再为搜索付费。** 把内置的 `web_search` 工具接到真正的搜索 API，把模型预算留给真正的思考。
>
> 🧩 **可插拔设计。** 一个中枢，多家服务商。目前内置 **Tavily**；架构从一开始就为后续接入更多主流搜索引擎而设计——挑你喜欢的，随时替换。
>
> 🎁 **免费起步。** Tavily 每月赠送 **1000 个免费额度**，无需信用卡即可开始，日常 Agent 检索完全够用。
>
> ✨ **做得精美。** 不是一个干巴巴的配置开关——dsh-searchhub 自带**手工打造的原生设置卡片**：可折叠、带实时三态状态圆点、真正的显示/隐藏眼睛按钮、即时的密钥格式校验，以及一个可点击的取密钥链接。它看起来就像产品自带的功能，因为它就是照着这个标准做的。

#### 📸 原生设置卡片

这是它在 **设置 → 插件** 里**自带**的精美卡片——实时状态圆点、真正的显示/隐藏按钮、行内格式校验，看起来就像产品原生功能。界面语言切到中文时，卡片文案**全中文**（对比上方英文效果，绝不混杂）：

<p align="center">
  <img src="docs/card-zh.png" alt="SearchHub 设置卡片（中文）" width="760">
</p>

---

#### ✨ 功能亮点

- 🔌 **可插拔搜索中枢** —— 干净的 provider 接缝，主流搜索引擎都能挂到 `ctx.web` 后面。**目前内置 Tavily**，并预留扩展空间。
- 💰 **零模型调用成本** —— 替换内置的 `web-search-deepseek` provider，让 `web_search` 打到真正的搜索 API，而不是一次付费模型调用。
- 🎨 **自带精美原生卡片** —— 在 **设置 → 插件 → 插件配置** 里作为独立、可折叠的卡片出现（端点、搜索深度、结果数、答案开关、API 密钥），带实时状态圆点、眼睛按钮、行内密钥格式校验。
- 🔐 **密钥处理得当** —— API 密钥作为**凭据引用**存储（默认 `TAVILY_API_KEY`），从界面或环境变量录入，永远不必写进配置文件。
- ⚡ **一条命令安装** —— 以 **dsh bundle** 形式发布，`dsh plugin add` 会自动装包**并激活**，无需手改 profile 的 patch 文件。
- 🧭 **结果归一化** —— 把 provider 结果映射成接缝已认识的 `{ sources, truncated }` 结构。

#### 🚀 安装

**方式 A —— 一条命令（推荐）**

因为本包在 `package.json` 里声明了 `dsh.bundle.patch`，DSH CLI 会自动安装并激活：

```bash
dsh plugin --profile web add dsh-searchhub
```

这一条命令会：1) 在 `$DSH_HOME/profiles/web` 里运行 `pnpm add dsh-searchhub`；2) 检测到本包的 `dsh.bundle` 声明，自动追加到 profile 的 `dsh.profile.bundles` 层列表，于是它的 `cordis.patch.yml`（把 `ctx.web` 切到 Tavily、禁用 `web-search-deepseek`、注册本插件的宿主端+浏览器端）在下次启动时生效。

然后重启 web 配置，打开 **设置 → 插件**，在 **SearchHub** 卡片里设置 API 密钥（或导出 `TAVILY_API_KEY`）。需要 `pnpm` 在 `PATH` 上。

> 也可以直接从 GitHub 安装：`dsh plugin --profile web add github:Bin-top1/dsh-searchhub`

**方式 B —— 手动 npm 安装 + 一行 patch**

```bash
cd "$DSH_HOME/profiles/web"
pnpm add dsh-searchhub
```

然后在 profile 自己的 `cordis.patch.yml` 里加：

```yaml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
- id: web-search-deepseek
  disabled: true
- insert:
    - id: searchhub
      name: "dsh-searchhub"
```

**方式 C —— 本地 checkout（完全不用 npm）**

克隆本仓库到稳定位置，用 `file://` 引用它的入口（Windows 用正斜杠 `file:///C:/Users/.../lib/index.js`）。

#### ⚙️ 配置项

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | secret 字符串 | - | 明文密钥（建议改用 `apiKeyEnv`）。 |
| `apiKeyEnv` | 凭据引用 | `TAVILY_API_KEY` | 密钥存储所用的环境变量名。 |
| `baseURL` | 字符串 | `https://api.tavily.com` | Tavily API 基址；会追加 `/search`。 |
| `searchDepth` | `basic` \| `advanced` | `basic` | 越深消耗 Tavily 额度越多。 |
| `maxResults` | 数字 (1-20) | `5` | 每次查询请求的结果数。 |
| `includeAnswer` | 布尔 | `false` | 是否让 Tavily 附带生成式答案。 |

**设置 API 密钥**（三选一）：1) **原生设置卡片**——在 **设置 → 插件 → 插件配置** 的 **SearchHub** 卡片里粘贴密钥，经凭据服务加密存储；2) **环境变量**——启动 DSH 前导出 `TAVILY_API_KEY`；3) **明文配置**——直接设 `apiKey`（不推荐）。在 <https://app.tavily.com/> 免费获取密钥与每月 1000 额度。

#### 🌏 界面语言

设置卡片自带 **英文 / 中文** 两套完整文案，跟随 DSH 的界面语言自动切换——界面是中文就全中文、是英文就全英文，绝不中英混杂。

#### 🛠️ 从源码构建

仓库已附带预构建的 `lib/index.js`（宿主端）与 `lib/client.js`（浏览器端），无需构建即可加载。宿主端的类型源码在 `src/types/`，`npm run build` 产出 `.d.ts`；浏览器端 `lib/client.js` 是唯一权威手写源，按 DSH 客户端模块扫描器所需的注册形式编写（React 与 JSX runtime 由宿主种子经 `require` 提供），无需打包器。

#### 🗺️ 路线图

dsh-searchhub 是一个**中枢**，而不是绑死单一引擎的壳子。Tavily 只是第一个 provider；接缝刻意做得通用，因此更多主流搜索后端都能挂到**同一张卡片**、走**同一套 ctx.web 契约**接入。欢迎贡献新的 provider。

---

> 以下为英文完整文档。

</details>

### Stop paying for your agent's web search.

**dsh-searchhub** is a pluggable **search hub** for the
[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It
lets your agent search the web through mainstream, drop-in search providers
behind the DSH web capability seam (`ctx.web`) — instead of burning paid
DeepSeek model turns on every `web_search` call.

> 💸 **No more paying for search.** Point the agent's built-in `web_search`
> tool at a real search API and keep your model spend for actual thinking.
>
> 🧩 **Pluggable by design.** One hub, many providers. Today it ships with
> **Tavily**; the architecture is built to add more of the market's popular
> search engines over time — pick the one you like and swap it in.
>
> 🎁 **Free to start.** Tavily gives you **1,000 free credits every month** — no
> credit card to get going. Plenty for everyday agent research.
>
> ✨ **Beautifully polished.** Unlike a bare config toggle, dsh-searchhub ships
> its **own** hand-crafted native Settings card — collapsible, with a live
> tri-state status dot, a real show/hide eye toggle, instant key-format
> validation, and a proper clickable link to grab your key. It looks like it
> belongs in the product, because it was built to.

#### 📸 The native Settings card

Its **own** polished card under **Settings → Plugins**, with a live status dot, a real show/hide toggle, and inline validation — it looks like it belongs in the product:

<p align="center">
  <img src="docs/card-en.png" alt="SearchHub settings card" width="760">
</p>

---

## ✨ Features

- 🔌 **Pluggable search hub** — a clean provider seam so mainstream search
  engines can be swapped in behind `ctx.web`. **Tavily is included today**, with
  room to grow.
- 💰 **Zero model-turn cost** — replaces the built-in `web-search-deepseek`
  provider, so `web_search` hits a real search API, not a paid model turn.
- 🎨 **Its own polished native card** — appears under **Settings → Plugins →
  Plugin configuration** as a dedicated, collapsible card (endpoint, search
  depth, max results, answer toggle, API key) with a live status dot, eye
  toggle, and inline key-format check.
- 🔐 **Secrets done right** — the API key lives as a **credential reference**
  (`TAVILY_API_KEY` by default), entered from the UI or the environment; it never
  has to sit in a config file.
- ⚡ **One-command install** — ships as a **dsh bundle**, so `dsh plugin add`
  installs *and* activates it. No hand-editing profile patch files.
- 🧭 **Normalized results** — maps provider results into the seam's
  `{ sources, truncated }` shape the agent already understands.

## 🚀 Installation

### Option A — one command (recommended)

Because this package declares `dsh.bundle.patch` in its `package.json`, the DSH
CLI installs it and activates it automatically:

```bash
dsh plugin --profile web add dsh-searchhub
```

That single command:

1. runs `pnpm add dsh-searchhub` inside `$DSH_HOME/profiles/web`, then
2. detects the package's `dsh.bundle` declaration and appends it to the
   profile's `dsh.profile.bundles` layer list, so its `cordis.patch.yml`
   (which switches `ctx.web` to Tavily, disables `web-search-deepseek`, and
   registers this plugin's host + browser halves) is applied on next boot.

Then restart the web profile and open **Settings → Plugins**; set the API key in
the *SearchHub* card (or export `TAVILY_API_KEY`). Requires `pnpm` on
your `PATH`.

> Installing straight from GitHub also works (its build step may need pnpm's
> `allowBuilds` approval that pnpm will print):
>
> ```bash
> dsh plugin --profile web add github:Bin-top1/dsh-searchhub
> ```

### Option B — manual npm install + one patch line

If you prefer not to use the `dsh plugin` forwarder, install the package into the
profile yourself and add one line to the profile's own patch layer:

```bash
cd "$DSH_HOME/profiles/web"
pnpm add dsh-searchhub
```

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
- id: web-search-deepseek
  disabled: true
- insert:
    - id: searchhub
      name: "dsh-searchhub"
```

### Option C — local checkout (no npm at all)

Clone this repo somewhere stable and reference its built entry by `file://`:

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
- id: web-search-deepseek
  disabled: true
- insert:
    - id: searchhub
      name: "file:///ABSOLUTE/PATH/TO/dsh-searchhub/lib/index.js"
```

> On Windows use a forward-slash `file:///C:/Users/.../lib/index.js` URL.

## ⚙️ Configuration

| Key            | Type                      | Default                   | Description                                              |
| -------------- | ------------------------- | ------------------------- | -------------------------------------------------------- |
| `apiKey`       | secret string             | -                         | Literal key (prefer `apiKeyEnv` instead).                |
| `apiKeyEnv`    | credential ref            | `TAVILY_API_KEY`          | Env-var name the key is stored under.                    |
| `baseURL`      | string                    | `https://api.tavily.com`  | Tavily API base; `/search` is appended.                  |
| `searchDepth`  | `basic` \| `advanced`     | `basic`                   | Deeper search costs more Tavily credits.                 |
| `maxResults`   | number (1-20)             | `5`                       | Results requested per query.                             |
| `includeAnswer`| boolean                   | `false`                   | Ask Tavily to include a generated answer.                |

### Setting the API key

Pick one:

1. **Native settings card** — open the **SearchHub** card under
   *Settings → Plugins → Plugin configuration* and paste the key into the API
   key box. It is stored encrypted through the credentials service (under the
   `TAVILY_API_KEY` reference by default).
2. **Environment variable** — export `TAVILY_API_KEY` (or whatever `apiKeyEnv`
   you set) before launching DSH.
3. **Literal config** — set `apiKey` directly (discouraged; keeps a secret in a
   file).

Get a key — and your **1,000 free credits/month** — at
<https://app.tavily.com/>.

### The native settings card (dual-face plugin)

The DSH web *Plugin configuration* surface does **not** auto-generate a card for
an arbitrary plugin. A card appears only when **both** halves are present:

1. **Host half** installs a settings section under a namespace (`searchhub`) —
   `lib/index.js`.
2. **Browser half** registers a React card into the `settings.plugin.item` slot,
   **keyed by that same namespace** — `lib/client.js`.

This plugin ships both, so it gets its **own** polished card (not a borrowed
one). The browser half is declared to the DSH client-modules scanner via
`package.json`:

```jsonc
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "exports": {
    ".":        { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" }
  }
}
```

The scanner serves `lib/client.js` to the browser as a classic script whose only
top-level statement is a single `window.__ModuleLoader__.load({ id, factory })`
call. React and the JSX runtime are **host-provided seed modules** obtained
through the factory's synchronous `require` — the browser half never bundles its
own React. The card's secret input writes to the `TAVILY_API_KEY` credential
reference through `ctx.remote.credentials.set(...)`, and the host half resolves
that same reference per search.

## 🗺️ Roadmap

dsh-searchhub is a **hub**, not a single-engine wrapper. Tavily is the first
provider; the seam is deliberately generic so more of the market's popular
search backends can be added behind the same card and the same `ctx.web`
contract. Contributions of new providers are welcome.

## 📦 Publishing (maintainers)

```bash
npm login
npm publish
```

The prebuilt `lib/` runtimes and `cordis.patch.yml` are included via the `files`
allowlist, so consumers do not need a build step.

## 🛠️ Building from source

```bash
npm install
npm run build      # emits lib/types/*.d.ts from src/ via tsc
```

The repository ships prebuilt `lib/index.js` (host half) and `lib/client.js`
(browser half) so the plugin loads without a build step. Both are hand-authored
in the exact form DSH loads (ESM module for the host; a
`window.__ModuleLoader__.load` registration script for the browser).

- **Host half:** typed sources live in `src/types/` (`index.ts`, `provider.ts`)
  and compile to the `.d.ts` declarations via `npm run build`. `lib/index.js` is
  the authoritative runtime.
- **Browser half:** `lib/client.js` is the single authoritative, hand-authored
  source — read it directly. It is intentionally written in the exact
  factory-registration form the DSH client-modules scanner serves (React and the
  JSX runtime come from the host seed via `require`), so it needs no bundler and
  has no separate `.ts` mirror to drift out of sync.

## 📄 License

MIT © Bin
