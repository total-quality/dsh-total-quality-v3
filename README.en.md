<p align="center"><img src="icon.svg" width="72" height="72" alt="Total Quality"></p>

<h1 align="center">Total Quality</h1>

<p align="center">Free, open-source quality management for small and midsize manufacturers</p>

<p align="center">
  <a href="https://github.com/total-quality/dsh-total-quality-v3/releases/latest"><img src="https://img.shields.io/github/v/release/total-quality/dsh-total-quality-v3?style=flat-square&amp;logo=github&amp;label=release&amp;labelColor=12213B&amp;color=2458B3" alt="Latest release"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/docs-installation-287BE0?style=flat-square&amp;labelColor=12213B" alt="Installation guide"></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-16886B?style=flat-square&amp;labelColor=12213B" alt="MIT License"></a>
  <a href="https://github.com/total-quality/dsh-total-quality-v3/stargazers"><img src="https://img.shields.io/github/stars/total-quality/dsh-total-quality-v3?style=flat-square&amp;logo=github&amp;label=stars&amp;labelColor=12213B&amp;color=AD722A" alt="GitHub stars"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-5458C8?style=flat-square&amp;labelColor=12213B" alt="DeepSeek Harness plugin"></a>
</p>

<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

<p align="center">
  <a href="#overview">Overview</a> · <a href="#quick-start">Quick Start</a> · <a href="#use-cases">Use Cases</a> · <a href="#features">Features</a> · <a href="#automation-and-approvals">Automation and Approvals</a> · <a href="#resources">Resources</a> · <a href="#releases">Releases</a>
</p>

## Overview

Total Quality is a quality workbench for small and midsize manufacturers, available as a DeepSeek Harness plugin. It is built around the issues a factory handles every day. An inspection finds an out-of-spec dimension, a shipment of incoming parts fails inspection, a customer reports defects, or a production team needs to change a fixture or work step. Quality engineers record what happened, the responsible lead reviews the evidence and approves a plan, and the people on the shop floor record what they did. The report and original records remain available after closure.

Consider a batch of bushings with an oversize outside diameter. Measurements are in a spreadsheet, the containment list is on the shop floor, and the reinspection results are attached to an email. Total Quality puts the batch, measurements, disposition, owner, deadline, and review comments in one work order. A saved lesson can take the next investigator back to the original case.

| Who uses it | What they do in Total Quality |
| --- | --- |
| Quality leads and supervisors | See what needs a decision, what is being worked on, and what evidence is missing. Review plans, return incomplete submissions, or close work orders. |
| Inspectors and quality engineers | Import measurements, trace affected lots, look up inspection requirements, investigate process variation with SPC, and open improvement projects for recurring issues. |
| Production, process, and purchasing teams | Follow assigned tasks and record containment, reinspection, rework, supplier feedback, or process changes in the work order. |
| Quality system and training leads | Maintain internal documents and lessons learned, prepare quality manuals and procedures, and record training and assessment results. |

![Quality dashboard showing decisions, work in progress, and recent activity](docs/preview/operations.png)

## Quick Start

1. Download `dsh-total-quality-v3.tgz` from the [latest release](https://github.com/total-quality/dsh-total-quality-v3/releases/latest) and add it in the DeepSeek Harness plugin manager. Open **全质开源质量平台2** in the sidebar.
2. Open a sample work order in **确认与纠正** (Review and Correct). Check which measurements triggered it, review the plan, and approve it. Find the same order in **执行跟进** (Execution Follow-up) to try submitting and reviewing a reinspection result.
3. When you are ready to use your own data, enter your company, departments, workshops, and products in **企业设置** (Company Settings). Download the measurement template from **接收与追溯** (Intake and Traceability), fill it with one lot's results, and review the import preview. You can also start by logging a current shop-floor issue or complaint. Before switching to production use, back up local data and clear the trial records in **System Settings → Data Management**.

For the web profile, you can also install from a terminal:

```sh
dsh plugin --profile web add https://github.com/total-quality/dsh-total-quality-v3/releases/download/v3.0.16/dsh-total-quality-v3.tgz
```

## Use Cases

### Production issue, from the first measurement to closure

Say a bushing's outside diameter has an upper limit of 12.10 mm and the inspection sheet contains a reading of 12.13 mm. After a quality engineer checks the file preview and accepts the import, the workbench screens measurements by lot and characteristic. The anomaly appears in the dashboard's review queue. The batch view shows measurements, out-of-spec readings, control chart signals, and Cpk when there are enough observations. Part-level defect counts come from the shop floor's reinspection.

The lead checks the original measurement and decides what needs to be contained, who will recheck it, and by when. After approval, the current task appears in the local to-do list. If the plan needs to change during execution, the lead can withdraw approval and return to plan review. The work order retains its task and submission history.

The shop-floor team records the action and attaches its evidence. A typical issue moves through **containment and impact assessment, verification of occurrence and escape causes, corrective action and standards updates, and verification across subsequent lots**. A lead can accept each result or return it with comments. If the first submission covers finished stock but leaves work in progress unaccounted for, the team can add the missing quantities and inspection records to the same order.

After correction, record each verification lot's date, sample size, defective count, and original record number. When business closure checks are enabled, the platform flags missing traceability, quantity, or verification records. Once the lead closes the case, the platform can generate a Word report and store a lesson learned. If new abnormal measurements arrive for the same batch, you can look up its earlier history by lot.

![Work order showing measurements, proposed actions, verification requirements, owners, and approval controls](docs/preview/work-order.png)

### Incoming material, complaints, and changes

| Scenario | What to record and follow up |
| --- | --- |
| **Incoming parts fail inspection** | Record the purchase or receipt reference, supplier lot, material, and inspection standard. Reconcile stock and material already issued to production. Capture containment, reinspection, and supplier feedback. |
| **Customer complaint or return** | Record the product, customer, shipment, and lot. Reconcile shipped and returned quantities and record containment, rework, or scrap. Use verified facts to prepare an 8D report for review. |
| **Process, fixture, or standard changes** | Record the change reference, applicable requirements, and verification plan. Compare results after implementation and record updates to risk analysis, control plans, work instructions, and training records. |
| **An issue needs a same-day response** | Use QRQC to record the initial response, temporary actions, owners, and deadlines. New actions from meeting minutes can become local tasks. Document the basis for closure after the work is complete. |

## Features

### Quality dashboard and issue records

The dashboard gives leads a place to review plans, inspect submitted results, follow execution, find missing information, and open archived orders. For a morning meeting, it shows what decision is due, who is doing the work, and what evidence still needs review. Screening activity and manual decisions are recorded over time.

The quality issue register tracks source, severity, status, and related projects. For recurring findings, look up similar cases and existing projects before deciding whether to start a new one. Once an approved work order enters execution, its issue, improvement project, approval status, and current task are connected.

### Data intake, traceability, and quality tools

Import measurements from Excel, CSV, or JSON. Confirm fields, limits, samples, and lot identifiers in the preview. Previously accepted duplicate files are skipped, and the intake log records the filename, record count, and time. The data management page also accepts issue lists, inspection results, material costs, and bills of materials. Use recorded lot and supplier details to trace an issue.

Use measurements already in the platform or paste a series of your own. The tools include Cpk and Ppk, I-MR, Xbar-R, Xbar-S and EWMA charts, Pareto charts, hypothesis tests, GR&R, DOE, Gantt scheduling, and quality cost calculations. For example, group defects by workshop or category in a Pareto chart, then examine a control chart for the process that accounts for the largest share.

### Improvement workbench and reports

- **8D.** Link an existing work order and bring in lot measurements and recorded evidence. The report follows D0–D8. Edit containment, 5 Whys, root causes, permanent actions, and rollout to similar processes. Supporting evidence can be added and reviewed as the investigation progresses.
- **PFMEA and DFMEA.** Document failure chains, effects, causes, and current prevention and detection controls for a process or design. Review S/O/D, RPN, and action priority with the team, then reassess the failure after the actions are in place. Save revisions to revisit later.
- **Management questions.** Ask what is holding up a work order, what evidence is still needed, or which open issues need attention. The workbench can use recorded work orders, measurements, and saved analyses.
- **Reports and savings.** Produce weekly, monthly, special investigation, root cause, SPC, and 8D reports in Word. Export 8D and FMEA analyses as Word, Excel, or Markdown and export issue or measurement records for review. Estimate savings using defect rates, volume, and unit loss, then document the reviewed amount, reviewer, and evidence.

### Company knowledge, quality system documents, and training

Upload quality manuals, customer requirements, process specifications, or product catalogs. Once indexed, ask what first-piece checks a lot change requires or which instruction governs acceptance for a work step. Follow a citation to the corresponding excerpt. You can also search existing lessons learned for similar cases.

For the quality system survey, review suggested fields and their supporting source before applying them. Relevant documents can supply values for products, applicable standards, process flows, and quality policy. Company settings can also take a suggested company name. Add missing responsibilities, objectives, audit plans, and sign-off details, then draft a quality manual, procedures, or work instructions. Preview and download the drafts in Markdown. The employee development page records training tasks and actual assessment results, with access to company procedures and lessons for coaching.

## Automation and Approvals

| The platform can | Who makes the decision |
| --- | --- |
| Screen accepted measurements immediately and rescan local data on a schedule. | The quality team confirms the source, limits, and lot before accepting an import. |
| Organize available evidence, suggest actions, assign approved tasks, and record overdue follow-ups. | The owner confirms containment scope, owners, and deadlines, and can edit the plan before approving. |
| Check submissions for required information and move the work order forward after review. | The people doing the work submit actual results. The lead verifies the original evidence, outcome, and closure criteria. |
| Prepare a closure report and a lesson learned according to the selected settings. | The lead decides when to close. External reports, ERP inventory holds, and shipment release are handled through the company's existing processes. |

Screening intervals, automatic drafting, dispatch, and archiving can be configured. Assistant questions, model-assisted drafting, and document extraction use the model configured in Harness. Imports, statistics, work orders, approvals, and standard Word reports are available without a model.

## Resources

- See the [installation guide](安装说明.md) for plugin manager and command-line installation. The in-app user guide explains each step from intake to closure.
- This release runs inside your local Harness instance. Work records, attachments, and original files stay on the machine. Use imports and local forms to bring in company data. Library storage depends on available disk space. The library shows how much space the saved originals use and how much is available for new files. Document questions and form extraction send relevant excerpts to the configured model.
- When [reporting an issue or suggesting an improvement](https://github.com/total-quality/dsh-total-quality-v3/issues), include the page and the steps you followed.

## Releases

[Download the latest release](https://github.com/total-quality/dsh-total-quality-v3/releases/latest) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE.md)
