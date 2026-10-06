# my-first-site

这是 1em0 的个人主页，一个用纯 HTML、CSS 和少量 JavaScript 编写的静态网站，不依赖任何框架或构建工具。

## 页面内容

- **顶部**：名字和一句话简介
- **关于我**：个人介绍
- **我的兴趣**：以卡片形式展示的兴趣爱好
- **联系方式**：邮箱、GitHub 等链接

页面在手机和电脑上都能正常显示，并支持深色模式（默认跟随系统设置，也可以点击右上角按钮手动切换）。

## 文件结构

```
.
├── index.html   # 页面结构（入口文件）
├── style.css    # 样式，包含深色模式和响应式布局
├── script.js    # 深色模式切换、页脚年份
└── README.md
```

## 本地预览

直接用浏览器打开 `index.html` 即可，不需要安装任何东西。

## 修改内容

目前页面中的文字和链接都是占位内容，可以直接编辑 `index.html` 替换：

- 一句话简介、关于我、兴趣卡片中的文字
- 「联系方式」区块里的邮箱和各个链接地址

## 发布到 GitHub Pages

1. 打开仓库的 **Settings → Pages**
2. 在 **Build and deployment** 中，Source 选择 **Deploy from a branch**
3. 选择 `main` 分支和 `/ (root)` 目录，保存
4. 稍等片刻，页面会发布到 `https://<用户名>.github.io/my-first-site/`
