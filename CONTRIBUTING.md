# 参与开发

欢迎修复 Bug、优化手机操作、改进 AI 与平衡，以及补充说明。项目只接受符合 [非商业学习交流许可](LICENSE) 的贡献；第三方素材还须遵守 [素材说明](ASSET_NOTICE.md)。请只提交有权分享的内容。

1. Fork 仓库，在自己的分支修改。
2. `npm run dev` 启动本地页面。
3. 运行 `npm run check`、`npm test` 和 `npm run build`。
4. Pull Request 写明问题、修改后的行为、如何验证，以及涉及的模式。

修复规则时请补充能复现该问题的测试。纯文案或轻微样式调整不必编写与实现重复的测试。手机布局和触控修改应说明是否做过真机验证。

修改联机（net.js、engine.js 网络分支、scripts/ws-relay.mjs）时，必须保持锁步确定性：模拟内禁止 `Date.now`、未种子随机数或 Promise 续体直改模拟状态，并保持 `tests/net-sync.test.cjs` 与 `tests/net-relay.test.cjs` 两套套件通过；详细约束见 [开发指南](docs/DEVELOPMENT.md)。

修改费用或卡池时，必须保留旧档迁移；修改角色顺序时不要改动稳定 ID。新增素材须提供来源与使用许可说明，不要把网站链接当作授权证明。

请勿提交 `dist/`、`releases/`、环境文件、登录信息或私人参考图片。生成的网页 ZIP 放到 Release，源码保持可以直接比较和修改的形式。
