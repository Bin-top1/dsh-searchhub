# 发布指南（维护者）

包名：**`@wilson.liu.cn/dsh-searchhub`**
仓库：https://github.com/Bin-top1/dsh-searchhub （`origin`，分支 `main`）

> **为什么是 scoped 名？** 原名 `dsh-searchhub` 与已有的 `dsh-search-hub`
> 只差一个连字符，被 npm 的防仿冒检查拒绝（`403 Package name too similar`）。
> scoped 名有独立命名空间，永不触发相似度检查。

## 零、发布前本地校验（不需要网络）

```bash
npm install            # 只装 devDependencies：typescript + 宿主类型包
npm run check          # 语法检查 + 全部测试（22 个）
npm run build          # 生成 lib/types/*.d.ts
npm publish --dry-run  # 先跑 prepublishOnly（= check + build），再列出将发布的文件
```

期望内容：**9 个文件，约 30 kB**（类型声明由 `prepublishOnly` 自动生成，不会漏）：

```
package.json                scripts/cli.mjs
README.md                   cordis.patch.yml
LICENSE                     lib/index.js
lib/types/index.d.ts        lib/client.js
lib/types/provider.d.ts
```

`tests/manifest.test.mjs` 钉住了三条硬性不变量，发布前务必全绿：

1. **`@deepseek-ai/*` 只能出现在 `peerDependencies` 且必须 `optional`**，绝不能进
   `dependencies`。npm 会自动安装 peerDependencies：只要有一个不是 optional，
   `npm install` 就会把 `cordis`、`dsh-web`、`dsh-settings` 等**十几个包的重复副本**
   装进 profile 的 `node_modules`，遮蔽 DSH 自带依赖闭包（版本漂移 + 重复实例）。
2. `cordis.patch.yml` 里 `insert: name:` 必须**逐字等于** package.json 的 `name`
   （`@wilson.liu.cn/dsh-searchhub`）。
3. `files` 白名单必须覆盖全部运行时文件，且不能带 `tests/`、`src/`、`docs/`、`.github/`。

> ⚠️ **bin 字段不要写 `./` 前缀。** npm 11.19 会把 `"./scripts/cli.mjs"` 判为无效并
> **静默删除**，发布出去的包就没有 `dsh-searchhub` 命令了。正确写法是
> `"scripts/cli.mjs"`。

## 一、提交并推送到 GitHub

```bash
git add -A
git commit -m "..."
git push origin main        # 不要 -f：正常快进即可
```

> 本机到 GitHub 的连接**偶尔会中断**（实测 `github.com:443` 短暂不可达、HTTP/2
> framing 报错）。提交是安全的，**隔几分钟重试即可**。若长期不通，可配置代理
> （`git config --global http.proxy http://127.0.0.1:7890`）或改用 SSH over 443。

## 二、发布到 npm

### 方式 A（推荐）—— CI 受信任发布，无需任何 token

`.github/workflows/build.yml` 里的 `publish` job 使用 **OIDC 受信任发布**：
只在推 `v*` tag 时触发，且必须等 `check` 矩阵全绿。

```bash
# 1. 改 package.json 的 version，提交推送
git add -A && git commit -m "Release v1.0.1" && git push origin main

# 2. 打 tag 并推送 —— 这一步才会触发发布
git tag v1.0.1 && git push origin v1.0.1
```

tag 必须与 `package.json` 的 version 完全一致，workflow 会校验并拦截不一致的情况。

**一次性配置（首次使用前，在 npmjs.com 完成）：**

打开 https://www.npmjs.com/package/@wilson.liu.cn/dsh-searchhub/access
→ **Publishing access** → **Trusted publishers** → 添加：

| 字段 | 值 |
| --- | --- |
| Provider | **GitHub Actions** |
| Organization | `Bin-top1` |
| Repository | `dsh-searchhub` |
| Workflow filename | **`build.yml`**（**只填文件名，不要写 `.github/workflows/` 路径**） |
| Environment | 留空 |

配错任何一项，`npm publish` 会返回 `404 PUT` 或 `403`（OIDC 握手成功但 npm 拒绝）。
workflow 在失败时会把这个配置清单直接打印到日志里。

### 方式 B —— 本地手动发布

需要一枚**带发布权限的 Granular Access Token**（在
https://www.npmjs.com/settings/wilson.liu.cn/tokens 创建）：

- Permissions 选 **Read and write (publish and stage)**
- 包范围可选 **Only select packages** → `@wilson.liu.cn/dsh-searchhub`

```bash
npm config set //registry.npmjs.org/:_authToken=npm_你的token
npm publish --access public     # ⚠️ scoped 包必须带 --access public
```

若 token 不带绕过 2FA 的直发权限，则改用一次性验证码：

```bash
npm publish --access public --otp=123456    # 6 位数字，30 秒内有效
```

> 📌 npm 已宣布**带直发权限的 bypass-2FA token 将在 2027 年 1 月取消**，
> 所以方式 A（OIDC）才是长期方案。

## 三、发布后自检

```bash
npm view @wilson.liu.cn/dsh-searchhub version bin
# 期望 version = 1.0.1，bin = { 'dsh-searchhub': 'scripts/cli.mjs' }
```

> 刚发布后**可能短暂查不到元数据**：发布流程会先 GET 探活并拿到 404，这个
> 负缓存会被 CDN 记住几分钟，表现为 `npm view` / `npm install` 报 404，
> 而 tarball 和 `dist-tags` 却是正常的。**等几分钟即自动恢复**，不要急着重发。

在临时目录验证真实的按名安装路径：

```bash
mkdir /tmp/verify && cd /tmp/verify && echo '{"name":"v","version":"1.0.0"}' > package.json
npm install @wilson.liu.cn/dsh-searchhub
./node_modules/.bin/dsh-searchhub status
```

再在**干净的临时 HOME** 里演练安装到 profile：

```bash
npx @wilson.liu.cn/dsh-searchhub install --home /tmp/dsh-home --profile web
DSH_HOME=/tmp/dsh-home dsh --profile web --dump-config | grep -E "searchhub|searchProvider"
# 期望：id: searchhub / searchProvider: tavily / web-search-deepseek 带 disabled: true
```

真机安装后重启 profile（`dsh web`），打开 **设置 → 插件 → SearchHub** 粘贴
Tavily 密钥，或在启动前导出 `TAVILY_API_KEY`。

## 四、版本升级流程

1. 改 `package.json` 的 `version`（可同时更新 `lib/index.js` 与
   `src/types/provider.ts` 里手写的 `USER_AGENT` 版本号，
   `tests/manifest.test.mjs` 会校验两者与 `version` 一致）；
2. 本地跑 `npm run check`；
3. 提交推送，然后 `git tag vX.Y.Z && git push origin vX.Y.Z` 触发 CI 发布。
