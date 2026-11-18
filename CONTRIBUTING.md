# 参与贡献

## 本地开发

本插件使用原生 JavaScript，没有前端构建步骤。
通过 DeepSeek Harness 安装本地插件目录，页面修改后刷新；宿主修改后重新加载或重装 bundle。

提交前运行：

    node --check index.js
    node --check host.cjs
    node --check public/app.js
    node 自检.cjs

自检使用临时数据目录，验证文件、Node/SQLite、建库、工具数量和 Cpk 计算。
UI 修改需要核对实际页面与窄屏布局；二维码修改需核对识别内容不变。

## 目录

- index.js、host.cjs：宿主入口、HTTP、业务服务。
- client.js：DSH 侧栏入口与 iframe。
- public/：页面、样式与服务二维码。
- src/tools/：数据、统计、业务与报告工具。
- src/lib/：SQLite 写穿、统计、文档与体系文件。
- src/data/：程序生成的样例数据。
- tools-dsh.cjs：18 个 qip_real_v3_* 宿主工具。

## 修改约定

维持 /qip-real-v3/、qip_real_v3_*、QIP_REAL_V3_DATA_DIR 的隔离关系。
报告下载链接和前端 API 路径应同步检查。
不要提交本机数据库、登录凭据、真实企业数据、日志、node_modules 或生成的报告。
功能或安装方式变化时同步更新 README.md 和安装说明.md。
提问题请附页面、复现步骤与期望行为；提交一个清晰的变更，并保留 MIT 版权与许可声明。
