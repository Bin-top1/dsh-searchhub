# 发布指南（维护者）

> 当前这台公司电脑有 Zscaler，CLI 连不上 GitHub / npm，只能浏览器传，
> 且网页拖拽会漏传文件夹。请在**没有 Zscaler 的电脑**（如家里）用 git 完成。

## 一、把完整项目推到 GitHub（补全被漏传的文件夹）

GitHub 仓库：https://github.com/Bin-top1/dsh-searchhub

在无 Zscaler 的电脑上，进入项目文件夹后：

```bash
git init
git add -A
git commit -m "Add full project (lib, src, docs, .github)"
git branch -M main
git remote add origin https://github.com/Bin-top1/dsh-searchhub.git
git push -f origin main
```

> `push -f` 会用完整项目覆盖现在残缺的仓库（现在线上只有 7 个根文件，
> 缺 lib/ src/ docs/ .github/）。推完刷新仓库首页，README 图片应正常显示。

完整项目应含 14 个文件：

```
.env.example
.github/workflows/build.yml
.gitignore
cordis.patch.yml
docs/card-en.png
docs/card-zh.png
lib/client.js
lib/index.js
LICENSE
package.json
README.md
src/types/index.ts
src/types/provider.ts
tsconfig.json
```

## 二、发布到 npm

包名 `dsh-searchhub`（已确认 npm 上未被占用）。本包是免构建的运行时插件，
`lib/*.js` 是现成手写文件，**无需 npm install / npm run build**。

```bash
npm login                 # 浏览器授权，本人登录
npm publish --dry-run     # 演练：应只打包 6 个文件
npm publish               # 正式发布（普通包名，不加 --access）
```

发布时打包进 npm 的文件（由 package.json 的 files 白名单控制）：

```
package.json
README.md
LICENSE
cordis.patch.yml
lib/index.js
lib/client.js
```

## 三、验证别人能一键安装

发布成功后，任何人在正常网络上：

```bash
dsh plugin --profile web add dsh-searchhub
```

在代码传到 GitHub 后、发 npm 之前，也可用：

```bash
dsh plugin --profile web add github:Bin-top1/dsh-searchhub
```