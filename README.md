<p align="center"><img src="icon.svg" width="72" height="72" alt="全质开源质量平台"></p>

<h1 align="center">全质开源质量平台</h1>

<p align="center">面向中小制造企业的免费开源质量管理平台</p>

<p align="center">
  <a href="https://github.com/total-quality/dsh-total-quality-v3/releases/latest"><img src="https://img.shields.io/github/v/release/total-quality/dsh-total-quality-v3?style=flat-square&amp;logo=github&amp;label=release&amp;labelColor=12213B&amp;color=2458B3" alt="最新版本"></a>
  <a href="安装说明.md"><img src="https://img.shields.io/badge/docs-installation-287BE0?style=flat-square&amp;labelColor=12213B" alt="安装说明"></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-16886B?style=flat-square&amp;labelColor=12213B" alt="MIT 许可证"></a>
  <a href="https://github.com/total-quality/dsh-total-quality-v3/stargazers"><img src="https://img.shields.io/github/stars/total-quality/dsh-total-quality-v3?style=flat-square&amp;logo=github&amp;label=stars&amp;labelColor=12213B&amp;color=AD722A" alt="GitHub Star 数"></a>
  <a href="#快速上手"><img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-5458C8?style=flat-square&amp;labelColor=12213B" alt="DeepSeek Harness plugin"></a>
</p>

<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>

<p align="center">
  <a href="#项目概览">项目概览</a> · <a href="#快速上手">快速上手</a> · <a href="#功能特性">功能特性</a> · <a href="#使用资料">使用资料</a> · <a href="#版本发布">版本发布</a>
</p>

## 项目概览

全质是一套运行在 DeepSeek Harness 里的质量管理工具。适合已经在用 Excel 检验表、问题台账和质量体系文件，想把日常质量工作集中起来的工厂。

巡检表发现轴套外径超差，照片发在群里，整改单放在共享目录，复测结果又来了封邮件。到了周会，谁在处理、库存隔离了多少、凭什么说整改有效，往往要翻好几处才能对上。全质把异常批次、原始测量、责任人、期限、处理措施和现场附件放进同一张工作单。从发现问题到结案，都能沿着这张单往下查。

![质量驾驶舱，查看待确认事项、执行进度和催办记录](docs/preview/operations.png)

## 快速上手

1. 在 DeepSeek Harness 的插件管理器添加 [发布页](https://github.com/total-quality/dsh-total-quality-v3/releases/latest) 的 `dsh-total-quality-v3.tgz`。安装后，在侧栏打开「全质开源质量平台2」。
2. 第一次试用可打开内置样例工作单，批准方案、查看待办，再提交一份复测结果。
3. 用自己的数据时，从「接收与追溯」导入测量表。现场问题、客户投诉和变更申请也可以直接登记。

Web 版用户也可以在终端安装：

```sh
dsh plugin --profile web add https://github.com/total-quality/dsh-total-quality-v3/releases/download/v3.0.11/dsh-total-quality-v3.tgz
```

## 功能特性

### 质量异常、派工与结案

导入 Excel、CSV 或 JSON 测量记录后，平台会核对批次、规格限和测量值，再按批次及检测项筛查。发现异常时生成工作单，供质量负责人查看原始数据和处理建议。

沿用轴套超差的例子，负责人可以在单据上调整围堵范围、人员和时限。批准后，任务进入站内待办。班组在原单填写隔离数量、是否已发货、复测结果，并附上检验记录。质量负责人复核；证据不足就退回补充。措施实施后，可登记后续批次的样本数、不良数和检验记录，再决定是否结案。

筛查周期、自动派工和结案归档可在系统设置中调整。**方案审批、执行结果复核和结案决定由负责人确认。** 平台记录经办人、时间与处理意见。

![质量工作单，包含异常测量、处理方案、责任人和审批操作](docs/preview/work-order.png)

### 批次追溯与过程分析

- **查批次与客诉。** 在工作单记录供应商、产品、批次、工序、检验依据及库存、在制和发货数量。处理客户投诉时，可以继续跟进影响范围、围堵和复测。
- **看过程有没有波动。** 通过 I-MR、Xbar-R、Xbar-S 或 EWMA 控制图查看过程波动，使用 GB/T 4091 判异准则检查异常信号，并查看 Cpk、Ppk 等过程能力指标。
- **做专项改进。** 重复问题可以立为改进项目，用 5Why 记录根因和验证依据。8D 可带入工作单与测量数据，PFMEA、DFMEA 支持填写失效链、复核措施优先级和保存修订记录。

### 企业知识库与体系文件

上传自己的质量手册、工序规范或产品目录，工作助手就能查企业资料。比如可以问「这道工序按哪份作业指导书验收？」回答带引用，便于打开原文核对。

企业已有资料也可以用来填写体系调研。平台从原文提取适用体系、产品、流程和质量方针等候选值，用户勾选带入后再审核保存。调研填写后，可生成质量手册、程序文件和作业文件草稿。

### 报告、经验与收益

可以从业务记录生成质量周报、月报、专项分析和 8D 等 Word 报告，8D 与 FMEA 也可导出 Excel 和 Markdown。结案时可以把排查经过和有效措施整理成经验卡。需要核算改进成效时，可记录产量、单位损失等测算依据，计算年化收益和回收期。

## 使用资料

- [安装说明](安装说明.md)涵盖插件管理器和命令行安装。
- 插件内的「使用指南」可随时查看工作单从资料接收、方案确认到复核归档的完整流程。
- 业务记录和上传的文件保存在本机，知识库容量为 100 MB。资料问答和表单提取会把相关片段交给 Harness 中配置的模型。统计、工作单和常规报表可在未配置模型时使用。

## 版本发布

[下载最新版](https://github.com/total-quality/dsh-total-quality-v3/releases/latest) · [查看更新记录](CHANGELOG.md) · [提交使用反馈](https://github.com/total-quality/dsh-total-quality-v3/issues)

本项目采用 [MIT 许可证](LICENSE.md)。