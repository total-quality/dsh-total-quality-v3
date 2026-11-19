# Total Quality

<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

**Free, open-source quality management for small and midsize manufacturers.** Total Quality runs as a DeepSeek Harness plugin. Open **全质开源质量平台2** from the sidebar, or go to `/qip-real-v3/` in a running Harness instance.

[Download the plugin](https://github.com/total-quality/dsh-total-quality-v3/releases/latest) · [Installation guide (Chinese)](安装说明.md)

The inspection sheet is in Excel, the photo of the defect is in a group chat, and the reinspection results arrive as an email attachment. At the weekly review, finding out how many parts are still in stock, who is rechecking them, and which record shows that the fix worked can mean searching three or four places.

Total Quality keeps the affected lot, original measurements, task owner, deadline, and attachments together in one work order. You can trace the issue back to its source records from there.

![Quality dashboard showing items awaiting review, corrective action progress, and recent activity](docs/preview/operations.png)

## From measurement to closure

Suppose the outside diameter of a batch of machined bushings is out of specification.

1. **Import the measurement sheet.** The platform checks for missing lot identifiers, specification limits, and measurements. Once you accept the import, it screens the records by lot and measured characteristic and creates a work order for an anomaly. You can also record a shop-floor issue, a customer complaint, or a change request directly.
2. **Review the plan and assign the work.** The quality lead sees the affected lot, measurements, and proposed actions. They can confirm what needs to be contained and adjust the owners and deadlines. Approved tasks appear in the platform's to-do list.
3. **Record what happened on the shop floor.** The production or process team records how many parts were segregated, whether any had shipped, and what was remeasured. They can attach stock lists or inspection records. The quality lead reviews the submission in the same work order and can send it back for more evidence.
4. **Verify the fix and close the work order.** Record the sample count, defects, and inspection records for subsequent lots to check whether the problem recurs. At closure, you can generate a Word report and save the investigation and effective actions as a reference for similar issues.

![Quality work order showing source measurements, the action plan, assigned owners, and approval controls](docs/preview/work-order.png)

## Day-to-day quality work

- **Review open issues.** See what needs approval, which actions are underway, and where evidence is missing. Open a flagged lot to review its work order and original measurements.
- **Trace incoming materials, production, and complaints.** Keep supplier, product, lot, workshop, and inspection details together. For a complaint, record the scope, stock, and shipped quantities, then follow containment, reinspection, and corrective action.
- **Analyze process variation.** Use I-MR, Xbar-R, Xbar-S, or EWMA control charts, check for signals using the eight GB/T 4091 rules, and review process capability and estimated defects per million with Cpk and Ppk.
- **Investigate recurring problems.** Start an 8D project, record causes with 5 Whys, and bring in the work order and measurements. Use the PFMEA and DFMEA forms to save revisions and review action priority (AP) with the team.
- **Prepare reports.** Generate weekly, monthly, special investigation, root cause, SPC, and 8D reports in Word. Export 8D and FMEA reports to Excel or Markdown as well.
- **Look up your own procedures.** Upload company manuals, process specifications, or product catalogs. Ask what first-piece checks are required after a lot change and follow the citations back to the source.
- **Prepare quality management system documents.** Bring applicable standards, products, process flows, and quality policy from existing files into the seven-section survey. Review and complete the survey, then generate drafts of the quality manual, procedures, and work instructions.
- **Estimate improvement savings.** Calculate annualized savings and payback using editable inputs and keep the assumptions with the record.

## Automation and approvals

Total Quality can screen measurements after import and on a schedule, gather evidence, draft actions, assign approved tasks, and record overdue follow-ups. You can configure the screening interval, automatic assignments, and archiving at closure.

**The person responsible approves the plan, reviews execution results, and decides when to close the work order.** Each decision records who made it and when. The people doing the work enter the actual measurements, containment results, and verification records. The statistical tools, work orders, and reports remain available without a configured model. Document questions, model-assisted drafting, and form extraction use the model configured in Harness.

## Getting started

```sh
dsh plugin --profile web add https://github.com/total-quality/dsh-total-quality-v3/releases/download/v3.0.11/dsh-total-quality-v3.tgz
```

You can also add the local `.tgz` package or plugin folder in the Harness plugin manager. Open **全质开源质量平台2** from the sidebar and try approving a sample work order and submitting its verification results. To try your own data, use **接收与追溯** (Intake and Traceability) to import a measurement sheet, a material list, or a bill of materials. You can also log a current shop-floor issue directly.

Work records and uploaded files are stored locally. The default data directory is `~/.dsh/qip-real-v3/data/` and can be set with `QIP_REAL_V3_DATA_DIR`. The document library holds up to 100 MB. Document questions and form extraction send relevant excerpts to the model configured in Harness.

Total Quality is available under the [MIT License](LICENSE.md). For project checks, see [Contributing](CONTRIBUTING.md).
