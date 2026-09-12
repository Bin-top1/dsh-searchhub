# 发布指南（维护者）

> **网络现状（本次会话实测，替换了旧的 Zscaler 假设）**
> `git push` 到 GitHub 成功（Git Credential Manager 已存有凭据）；`npm` 也能访问
> `registry.npmjs.org` 拉取元数据。所以推送可以在本机完成，**只有 `npm publish`
> 还需要 `npm login`**（npm 的登录与 git 凭据是两套）。若某天 CLI 又不通，
> 再换到没有 Zscaler 的电脑按同样的命令执行即可。
> 包名 `dsh-searchhub` 已确认未被占用（查询返回 404）。

## 零、发布前本地校验（不需要网络，也不需要 pnpm）

```bash
npm install            # 只装 devDependencies：typescript + 宿主类型包
npm run check          # 语法检查 + 全部测试（安装器行为 + 打包不变量）
npm run build          # 生成 lib/types/*.d.ts
npm publish --dry-run  # 先跑 prepublishOnly（= check + build），再列出将发布的文件
```

期望的发布内容（**9 个文件，约 30 kB**；`npm run build` 产出的类型声明由
`prepublishOnly` 自动生成，所以永远不会漏）：

```
package.json                scripts/cli.mjs
README.md                   cordis.patch.yml
LICENSE                     lib/index.js
lib/types/index.d.ts        lib/client.js
lib/types/provider.d.ts
```

`tests/manifest.test.mjs` 把三条硬性不变量钉住了，发布前务必是绿的：

1. **`@deepseek-ai/*` 只能是 optional peer**，绝不能出现在 `dependencies`。
   npm 会自动安装 peerDependencies：只要有一个不是 optional，`npm install`
   就会把 `cordis`、`dsh-web`、`dsh-settings`、`dsh-credentials`、`schemastery`
   等 **18 个包的重复副本**装进 profile 的 `node_modules`，遮蔽 DSH 安装自带的
   依赖闭包（版本漂移 + 重复实例）。改成 optional 后实测只装 1 个包，插件通过
   Node 的父目录查找命中 `$DSH_HOME/profiles/node_modules` 里的宿主包。
2. `dsh.bundle.patch` 指向的 `cordis.patch.yml` 里 `insert: name:` 必须等于
   package.json 的 `name`（都是 `dsh-searchhub`）。
3. `files` 白名单必须覆盖 `lib/index.js`、`lib/client.js`、`scripts/cli.mjs`、
   `cordis.patch.yml`、`README.md`、`LICENSE`，且不能带 `tests/`、`src/`、
   `docs/`、`.github/`。

## 一、提交并推送到 GitHub

GitHub 仓库：https://github.com/Bin-top1/dsh-searchhub（`origin`，分支 `main`）

```bash
git add -A
git commit -m "Add npm installer, optional peers, tests and CI"
git push origin main        # 不要 -f：线上仓库已含完整项目，正常快进即可
```

> 之前本文档写过「线上只有 7 个根文件、需要 `push -f` 覆盖」——**那是过期信息**。
> 实测 `origin/main` 早已跟踪全部 15 个文件（含 `lib/`、`src/`、`docs/`、`.github/`），
> 本次会话的 3 个提交也是**快进推送**成功的（`479977a..b647f96 main -> main`）。
> 只有确实需要重写历史时才用 `-f`。

> 关于 Zscaler：本文档原先假设本机 CLI 连不上 GitHub / npm。实测**都能连**：
> `git push` 走 Git Credential Manager（`credential.helper=manager`）已成功；
> `npm` 也能从 `registry.npmjs.org` 拉取元数据（沙箱外无需 `--cache` 变通）。
> 只有 `npm publish` 还需要先 `npm login`（git 的凭据不用于 npm）。

仓库应含 20 个文件（`node_modules/`、`lib/types/` 为生成物，已被忽略）：

```
.env.example
.github/workflows/build.yml
.gitignore
LICENSE
PUBLISH.md
README.md
cordis.patch.yml
docs/card-en.png
docs/card-zh.png
lib/client.js
lib/index.js
package-lock.json
package.json
scripts/cli.mjs
src/types/index.ts
src/types/provider.ts
tests/cli.test.mjs
tests/manifest.test.mjs
tests/pack.test.mjs
tsconfig.json
```

## 二、发布到 npm

包名 `dsh-searchhub`。本包是免构建的运行时插件（`lib/*.js` 是现成手写文件），
**无需**在使用者那侧 `npm install` 依赖或 `npm run build`。

```bash
npm login                 # 浏览器授权，本人登录
npm publish --dry-run     # 演练：应列出 9 个文件
npm publish               # 正式发布（普通包名，不加 --access）
```

## 三、发布后自检

```bash
npm view dsh-searchhub version     # → 1.0.0
```

在一台**干净的临时 HOME** 里演练，确认 npm 路线真的可用：

```bash
npx dsh-searchhub install --home /tmp/dsh-home --profile web
DSH_HOME=/tmp/dsh-home dsh --profile web --dump-config | grep -E "searchhub|searchProvider"
# 期望：id: searchhub / searchProvider: tavily / web-search-deepseek 带 disabled: true
```

然后任何人在正常网络上：

```bash
# npm 路线（不需要 pnpm）
npx dsh-searchhub install --profile web

# 有 pnpm 时也可以走 DSH 官方转发器
dsh plugin --profile web add dsh-searchhub
```

真机安装后重启 profile（`dsh web`），打开 **设置 → 插件 → SearchHub** 粘贴
Tavily 密钥，或在启动前导出 `TAVILY_API_KEY`。

## 四、版本升级流程

1. 改 `package.json` 的 `version`（同时可考虑更新 `lib/index.js` 里的
   `USER_AGENT` 版本号，它目前是手写的 `dsh-searchhub/1.0.0`）；
2. `npm run check && npm publish`；
3. `git add -A && git commit -m "Release vX.Y.Z" && git tag vX.Y.Z && git push --tags`。
