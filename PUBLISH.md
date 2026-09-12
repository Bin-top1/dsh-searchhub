# 发布指南（维护者）

> 当前这台公司电脑有 Zscaler，CLI 连不上 GitHub / npm，只能浏览器传，
> 且网页拖拽会漏传文件夹。请在**没有 Zscaler 的电脑**（如家里）用 git 完成。
> 现在 npm registry 已证实「包名 `dsh-searchhub` 未被占用」（查询返回 404）。

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

## 一、把完整项目推到 GitHub

GitHub 仓库：https://github.com/Bin-top1/dsh-searchhub

在无 Zscaler 的电脑上，进入项目文件夹后：

```bash
git init
git add -A
git commit -m "Add npm installer, optional peers, tests and CI"
git branch -M main
git remote add origin https://github.com/Bin-top1/dsh-searchhub.git
git push -f origin main
```

> `push -f` 会用完整项目覆盖现在残缺的仓库（线上只有 7 个根文件，缺
> `lib/`、`src/`、`docs/`、`.github/`、`scripts/`、`tests/`）。推完刷新仓库
> 首页，README 图片应正常显示。

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
