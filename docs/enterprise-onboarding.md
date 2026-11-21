# 企业部署与知识库接入

全质在运行 DeepSeek Harness 的机器上保存业务台账、知识库原文件和索引。企业可以先用一个独立目录上线，再把文件服务器或文控系统中已批准的资料导入。本文依次说明空白启动、手工入库、接口入库和外部系统适配。

## 1. 用空白数据开始

从 3.0.19 起，新数据目录默认从空白业务台账启动。已部署的目录会继续读取原有数据。试用过旧版的企业可选择一个新的数据目录做正式部署，再迁移经过审核的资料。

在运行 Harness 的终端设置数据目录。选一个可写的绝对路径，并让同一套部署以后始终使用这个路径。

**Windows PowerShell**

```powershell
$env:QIP_REAL_V3_DATA_DIR = 'C:\QipData\production'
Remove-Item Env:QIP_REAL_V3_SEED_DEMO -ErrorAction SilentlyContinue
dsh web
```

**Linux**

```sh
QIP_REAL_V3_DATA_DIR=/var/lib/qip/production QIP_REAL_V3_SEED_DEMO=0 dsh web
```

首次进入后，先到「系统 → 企业设置」登记公司、部门、车间及产品。到「知识与团队 → 员工成长中心」新增真实人员，再到「系统 → 系统设置 → 员工签核」绑定首位质量主管。之后从「接收与追溯」下载测量模板，用一个批次做预检和入库验证。

如需演示，另选一个从未使用的数据目录，并在首次启动时设置 `QIP_REAL_V3_SEED_DEMO=1`。例如关闭当前测试进程后，在 Windows PowerShell 运行：

```powershell
$env:QIP_REAL_V3_DATA_DIR = 'C:\QipData\demo'
$env:QIP_REAL_V3_SEED_DEMO = '1'
dsh web
```

一套 Harness 进程使用一个数据目录。切换目录后需重启进程。默认位置是 `~/.dsh/qip-real-v3/data/`，`DSH_HOME` 可改变其上级位置。旧版如已混入真实资料，先在「业务备份与审计归档」创建备份，再从源系统重新导出需要迁移的资料。业务备份会还原备份本身包含的记录，含样例的备份会一并还原样例。

## 2. 先导入一份受控文件

1. 从企业文控系统导出可供本实例成员共同使用的有效版，例如一份进料检验指导书。
2. 在「知识与团队 → 知识库文件」上传。支持 TXT、Markdown、CSV、DOCX、XLSX。服务端装有 Poppler 的 `pdftotext` 时也支持带文字层的 PDF。扫描件请先在企业侧 OCR，整理成可提取的文本。
3. 等状态变为「可检索」，打开「登记版次」，核对文件编号、版次、生效日、产品和工序，再发布。已有旧版时填写替代关系。
4. 用文件中的一句有辨识度的工艺要求测试关键词检索。配置好 Harness 模型后，在「AI 工作助手」勾选「查知识库」，提问并打开引用核对原文。

文件库和结案经验卡分别管理。上传一份指导书会生成文件索引。完成工作单后沉淀的经验卡走「知识库与经验传承」。资料问答和资料提取会把相关原文片段交给当前 Harness 模型。涉密资料导入前，应先确认模型的部署位置、访问范围及企业数据政策。

## 3. 按现有系统选接入方式

| 资料来源 | 企业侧的适配方式 |
| --- | --- |
| Windows 共享目录、NAS、内网文件服务器 | 指定经批准的导出目录，先导出文件和版次清单，再手工上传或由内网任务推送。文件服务器继续负责原件和权限管理。 |
| SharePoint、Microsoft 365 | 从允许的站点和文档库导出；需要增量时可由企业任务用 Microsoft Graph 的增量查询跟踪变更，再下载原件。 [增量查询](https://learn.microsoft.com/graph/api/driveitem-delta?view=graph-rest-1.0) · [下载文件](https://learn.microsoft.com/graph/api/driveitem-get-content?view=graph-rest-1.0) |
| Confluence | 从已授权的空间导出指定页面和附件。页面正文可在企业侧转换为 Markdown，附件直接保留原格式。Cloud 和 Data Center 使用各自的接口。 [Cloud 附件接口](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/) · [Data Center 接口](https://developer.atlassian.com/server/confluence/rest/latest/) |
| 自建 DMS、QMS、内网知识门户、对象存储 | 从文档列表或导出接口取文档 ID、版本、生效日及文件内容。把字段映射到下表，通过统一上传接口入库。 |

当前支持**导出后导入**或**由企业侧适配任务推送**。源端登录、定时同步、目录映射、SSO 以及逐份文件的权限同步由企业侧适配。插件文件库内的资料可被该实例中有访问权限的员工检索。阅读范围不同的文档，请按使用人群分实例部署，或只导入允许共同检索的子集。产品、工序字段用于过滤搜索结果。

批量接入时，可在企业侧保存 `源系统 + 源文件 ID + 源版次`、内容哈希和返回的插件文档 ID。增量任务先检查变更，再下载允许同步的原件。等索引完成并核对版次后登记本次同步结果。源端撤回文件时，由文控人员停用相应版次。已被历史工作单引用的原件可保留追溯。

| 源文控字段 | 插件字段 |
| --- | --- |
| 外部文件编号 | `documentNumber` |
| 生效版次 | `revision` |
| 生效日期（YYYY-MM-DD） | `effectiveFrom` |
| 适用产品和工序 | `product`、`process` |
| 被替代版对应的插件文档 ID | `supersedes` |
| 目标版次状态 | `revisionState`，登记为 `draft` 或 `released`；已发布文件可用 `withdrawn` 停用 |

上传成功后的文件初始为未受控资料，索引完成后可以参与检索。接入正式实例时，先从源端筛出已批准共享的有效资料。需要同时验证历史版或未生效版时，先在独立试点实例核对版次和检索结果。

## 4. 用接口试传一份文件

示例在 **Harness 主机**上执行，假定 Web 服务在 `127.0.0.1:3080`，并已按第 1 节配置质量主管账号。输入插件的员工签核账号，文件和会话通过现有本机接口发送。

```powershell
$api = 'http://127.0.0.1:3080/qip-real-v3/api'
$file = Get-Item -LiteralPath 'C:\QipExchange\进料检验指导书.docx'
$user = Read-Host '插件质量主管账号'
$password = Read-Host '密码' -AsSecureString
try {
    $credential = [pscredential]::new($user, $password)
    $login = @{
        username = $user
        password = $credential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress
    Invoke-RestMethod "$api/signing/login" -Method Post -ContentType 'application/json' `
        -Body ([Text.Encoding]::UTF8.GetBytes($login)) -SessionVariable qipSession | Out-Null
} finally {
    Remove-Variable password, credential, login -ErrorAction SilentlyContinue
}

$name = [uri]::EscapeDataString($file.Name)
$uploaded = Invoke-RestMethod "$api/library?filename=$name" -Method Post `
    -ContentType 'application/octet-stream' -InFile $file.FullName -WebSession $qipSession
$id = $uploaded.document.id

(Invoke-RestMethod "$api/library" -WebSession $qipSession).documents |
    Where-Object id -eq $id | Select-Object id, name, status, error
```

新文件返回 HTTP 202，索引在后台完成。相同内容再次上传返回 HTTP 200 和已存在的文档 ID。列表中的 `status` 为 `ready` 时可检索，为 `failed` 时先查看 `error`。如需在适配任务中登记版次，使用带主管会话的 `PUT /qip-real-v3/api/library/<id>/version`，JSON 字段见上表。首次发布填入生效日，发布替代版时填写最新旧版的插件文档 ID，并使用较晚的生效日。

检索接口为 `GET /qip-real-v3/api/library/search?q=<URL 编码的关键词>`，可加 `product` 和 `process`。生产环境由企业内网任务访问已配置的授权入口，主管会话及源系统凭据放在企业批准的密钥管理服务。当前接口使用插件的员工会话，适配任务在会话失效后需要重新认证。

## 5. 验收与备份

- 在空白实例确认待办、工作单、测量和人员台账为空，再录入本企业资料。
- 用有旧版和新版的同一份指导书测试搜索。核对当前有效内容、产品和工序、版次及原文出处。
- 用同一文件重传验证去重，用同一文号的新内容验证新版登记。
- 检查哪些员工能够阅读已导入文件，确认模型只能接收企业批准的资料。
- 在「业务备份与审计归档」创建 `.qipbackup`。先在独立实例预检还原，检查原件、索引和业务关联，再进行正式迁移。
