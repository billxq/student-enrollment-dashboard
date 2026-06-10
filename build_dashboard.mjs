import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workspace = process.cwd();
const outputDir = path.join(workspace, "outputs", "学籍看板_2025学年度第二学期");
const archiveDir = path.join(workspace, "archive", "2025学年度");
const archiveFile = path.join(archiveDir, "2025年度.xlsx");
const outputFile = path.join(outputDir, "学籍看板_2025学年度第二学期.xlsx");

function gradeOrder(text) {
  const m = String(text ?? "").match(/([一二三四五六七八九十]+)年级/);
  if (!m) return 99;
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return [...m[1]].reduce((n, ch) => n * 10 + (map[ch] ?? 0), 0);
}

function classOrder(text) {
  const grade = gradeOrder(text);
  const m = String(text ?? "").match(/(\d+)班/);
  const cls = m ? Number(m[1]) : 99;
  return grade * 100 + cls;
}

function setBand(range, fill, font = {}) {
  range.format.fill = fill;
  range.format.font = {
    name: "Microsoft YaHei",
    size: 11,
    color: "#FFFFFF",
    bold: true,
    ...font,
  };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.wrapText = true;
}

function setHeader(range, fill = "#0F766E") {
  range.format.fill = fill;
  range.format.font = { name: "Microsoft YaHei", size: 11, color: "#FFFFFF", bold: true };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.wrapText = true;
}

function setLabel(range, fill = "#E5E7EB") {
  range.format.fill = fill;
  range.format.font = { name: "Microsoft YaHei", size: 10, color: "#111827", bold: true };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.wrapText = true;
}

function setValue(range, fill = "#FFFFFF", color = "#111827") {
  range.format.fill = fill;
  range.format.font = { name: "Microsoft YaHei", size: 18, color, bold: true };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.wrapText = true;
}

function applyTableFrame(range) {
  range.format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    const g = gradeOrder(a.grade) - gradeOrder(b.grade);
    if (g !== 0) return g;
    const c = classOrder(a.className) - classOrder(b.className);
    if (c !== 0) return c;
    return String(a.name).localeCompare(String(b.name), "zh-Hans-CN");
  });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });

  const xlsxFiles = (await fs.readdir(workspace, { withFileTypes: true }))
    .filter((f) => f.isFile() && f.name.endsWith(".xlsx"));
  const sourceName = xlsxFiles.find((f) => f.name !== path.basename(outputFile))?.name;
  if (!sourceName) {
    throw new Error("未找到源 Excel 文件。");
  }

  await fs.copyFile(path.join(workspace, sourceName), archiveFile);

  const source = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(workspace, sourceName)));
  const sheetMeta = JSON.parse((await source.inspect({ kind: "sheet", include: "id,name" })).ndjson.split("\n")[0]);
  const sourceSheet = source.worksheets.getItem(sheetMeta.name);
  const sourceValues = sourceSheet.getUsedRange().values;
  const headers = sourceValues[0];
  const idx = Object.fromEntries(headers.map((h, i) => [String(h), i]));

  const rows = [];
  for (let r = 1; r < sourceValues.length; r += 1) {
    const row = sourceValues[r];
    rows.push({
      name: row[idx["学生姓名"]] ?? "",
      grade: row[idx["学生年级"]] ?? "",
      className: row[idx["学生班级名称"]] ?? "",
      gender: row[idx["学生性别"]] ?? "",
      status: row[idx["学生当前状态"]] ?? "",
      province: row[idx["学生户口省份"]] ?? "",
      ethnicity: row[idx["学生民族"]] ?? "",
    });
  }
  sortRows(rows);

  const grades = [...new Set(rows.map((r) => String(r.grade)))].sort((a, b) => gradeOrder(a) - gradeOrder(b));
  const classes = [...new Set(rows.map((r) => String(r.className)))].sort((a, b) => classOrder(a) - classOrder(b));

  const wb = Workbook.create();
  const dashboard = wb.worksheets.add("看板");
  const indexSheet = wb.worksheets.add("学生索引");
  const gradeSheet = wb.worksheets.add("年级统计");
  const classSheet = wb.worksheets.add("班级统计");
  const archiveSheet = wb.worksheets.add("归档索引");
  const noteSheet = wb.worksheets.add("说明");

  for (const sheet of [dashboard, indexSheet, gradeSheet, classSheet, archiveSheet, noteSheet]) {
    sheet.showGridLines = false;
  }

  // 学生索引
  const indexHeaders = [["学生姓名", "学生年级", "学生班级名称", "学生性别", "学生当前状态", "学生户口省份", "学生民族", "户籍分类", "民族分类"]];
  indexSheet.getRange("A1:I1").values = indexHeaders;
  const indexValues = rows.map((r) => [r.name, r.grade, r.className, r.gender, r.status, r.province, r.ethnicity]);
  indexSheet.getRangeByIndexes(1, 0, indexValues.length, 7).values = indexValues;
  indexSheet.getRange("H2").formulas = [[`=IF(F2="上海市","本市户籍","非本市户籍")`]];
  indexSheet.getRange("I2").formulas = [[`=IF(G2="汉族","汉族","少数民族")`]];
  indexSheet.getRange(`H2:I${rows.length + 1}`).fillDown();
  indexSheet.tables.add(`A1:I${rows.length + 1}`, true, "StudentIndex");
  indexSheet.freezePanes.freezeRows(1);
  indexSheet.getRange("A1:I1").format = {
    fill: "#0F766E",
    font: { name: "Microsoft YaHei", size: 11, color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  indexSheet.getRange(`A2:I${rows.length + 1}`).format.font = { name: "Microsoft YaHei", size: 10, color: "#111827" };
  applyTableFrame(indexSheet.getRange(`A1:I${rows.length + 1}`));
  indexSheet.getRange("A:I").format.columnWidthPx = 110;
  indexSheet.getRange("A:A").format.columnWidthPx = 120;
  indexSheet.getRange("B:C").format.columnWidthPx = 110;
  indexSheet.getRange("D:E").format.columnWidthPx = 90;
  indexSheet.getRange("F:F").format.columnWidthPx = 120;
  indexSheet.getRange("G:I").format.columnWidthPx = 100;
  indexSheet.getRange(`A2:I${rows.length + 1}`).format.rowHeightPx = 24;

  // Dashboard
  dashboard.getRange("A1:N1").merge();
  dashboard.getRange("A1").values = [["学籍信息看板 - 2025学年度第二学期"]];
  dashboard.getRange("A2:N2").merge();
  dashboard.getRange("A2").values = [[`户籍统计口径：学生户口省份=上海市计为本市户籍；空白、62 等异常值默认计为非本市户籍。民族统计以“汉族”与少数民族区分。`]];
  setBand(dashboard.getRange("A1:N1"), "#0F766E", { size: 18 });
  dashboard.getRange("A2:N2").format.fill = "#ECFDF5";
  dashboard.getRange("A2:N2").format.font = { name: "Microsoft YaHei", size: 10, color: "#064E3B" };
  dashboard.getRange("A2:N2").format.horizontalAlignment = "left";
  dashboard.getRange("A2:N2").format.verticalAlignment = "center";
  dashboard.getRange("A2:N2").format.wrapText = true;
  dashboard.getRange("A2:N2").format.borders = { preset: "outside", style: "thin", color: "#A7F3D0" };
  for (const addr of ["A4:B4", "D4:E4", "G4:H4", "J4:K4", "M4:N4", "A8:B8", "D8:E8", "G8:H8", "J8:K8"]) {
    dashboard.getRange(addr).merge();
  }
  dashboard.getRange("A4").values = [["总人数"]];
  dashboard.getRange("D4").values = [["男生"]];
  dashboard.getRange("G4").values = [["女生"]];
  dashboard.getRange("J4").values = [["在读"]];
  dashboard.getRange("M4").values = [["休学"]];
  dashboard.getRange("A8").values = [["本市户籍"]];
  dashboard.getRange("D8").values = [["非本市户籍"]];
  dashboard.getRange("G8").values = [["少数民族"]];
  dashboard.getRange("J8").values = [["其他/异常"]];

  dashboard.getRange("A5").formulas = [[`=COUNTA('学生索引'!$A$2:$A$${rows.length + 1})`]];
  dashboard.getRange("D5").formulas = [[`=COUNTIF('学生索引'!$D$2:$D$${rows.length + 1},"男性")`]];
  dashboard.getRange("G5").formulas = [[`=COUNTIF('学生索引'!$D$2:$D$${rows.length + 1},"女性")`]];
  dashboard.getRange("J5").formulas = [[`=COUNTIF('学生索引'!$E$2:$E$${rows.length + 1},"在读")`]];
  dashboard.getRange("M5").formulas = [[`=COUNTIF('学生索引'!$E$2:$E$${rows.length + 1},"休学")`]];
  dashboard.getRange("A9").formulas = [[`=COUNTIF('学生索引'!$H$2:$H$${rows.length + 1},"本市户籍")`]];
  dashboard.getRange("D9").formulas = [[`=COUNTIF('学生索引'!$H$2:$H$${rows.length + 1},"非本市户籍")`]];
  dashboard.getRange("G9").formulas = [[`=COUNTIF('学生索引'!$I$2:$I$${rows.length + 1},"少数民族")`]];
  dashboard.getRange("J9").formulas = [[`=COUNTIF('学生索引'!$H$2:$H$${rows.length + 1},"非本市户籍")-D9`]];

  for (const addr of ["A4:B5", "D4:E5", "G4:H5", "J4:K5", "M4:N5", "A8:B9", "D8:E9", "G8:H9", "J8:K9"]) {
    applyTableFrame(dashboard.getRange(addr));
  }
  for (const addr of ["A4:B4", "D4:E4", "G4:H4", "J4:K4", "M4:N4", "A8:B8", "D8:E8", "G8:H8", "J8:K8"]) {
    setLabel(dashboard.getRange(addr), "#E5E7EB");
  }
  for (const addr of ["A5:B5", "D5:E5", "G5:H5", "J5:K5", "M5:N5", "A9:B9", "D9:E9", "G9:H9", "J9:K9"]) {
    dashboard.getRange(addr).merge();
    setValue(dashboard.getRange(addr), "#FFFFFF");
  }
  dashboard.getRange("A5").format.numberFormat = "0";
  dashboard.getRange("D5").format.numberFormat = "0";
  dashboard.getRange("G5").format.numberFormat = "0";
  dashboard.getRange("J5").format.numberFormat = "0";
  dashboard.getRange("M5").format.numberFormat = "0";
  dashboard.getRange("A9").format.numberFormat = "0";
  dashboard.getRange("D9").format.numberFormat = "0";
  dashboard.getRange("G9").format.numberFormat = "0";
  dashboard.getRange("J9").format.numberFormat = "0";
  dashboard.getRange("A4:N9").format.rowHeightPx = 30;

  dashboard.getRange("A12:D12").values = [["状态组成", "人数", "", ""]];
  dashboard.getRange("A13:B15").values = [
    ["在读", null],
    ["休学", null],
    ["其他/异常", null],
  ];
  dashboard.getRange("A12:B12").merge();
  dashboard.getRange("A12").values = [["当前状态构成"]];
  dashboard.getRange("A12:B12").format.fill = "#1D4ED8";
  dashboard.getRange("A12:B12").format.font = { name: "Microsoft YaHei", size: 11, color: "#FFFFFF", bold: true };
  dashboard.getRange("A12:B12").format.horizontalAlignment = "center";
  dashboard.getRange("A12:B12").format.verticalAlignment = "center";
  dashboard.getRange("A13:B15").format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  dashboard.getRange("A13:A15").format.font = { name: "Microsoft YaHei", size: 10, color: "#111827", bold: true };
  dashboard.getRange("A13:A15").format.fill = "#F9FAFB";
  dashboard.getRange("B13").formulas = [[`=COUNTIF('学生索引'!$E$2:$E$${rows.length + 1},"在读")`]];
  dashboard.getRange("B14").formulas = [[`=COUNTIF('学生索引'!$E$2:$E$${rows.length + 1},"休学")`]];
  dashboard.getRange("B15").formulas = [[`=COUNTIF('学生索引'!$H$2:$H$${rows.length + 1},"非本市户籍")-D9`]];
  dashboard.getRange("B13:B15").format.numberFormat = "0";
  dashboard.getRange("A13:B15").format.horizontalAlignment = "center";
  dashboard.getRange("A13:B15").format.verticalAlignment = "center";
  dashboard.getRange("A13:B15").format.rowHeightPx = 24;
  dashboard.getRange("E12:H12").values = [["说明"]];
  dashboard.getRange("E12:H12").merge();
  dashboard.getRange("E12:H12").format.fill = "#1D4ED8";
  dashboard.getRange("E12:H12").format.font = { name: "Microsoft YaHei", size: 11, color: "#FFFFFF", bold: true };
  dashboard.getRange("E12:H12").format.horizontalAlignment = "center";
  dashboard.getRange("E12:H12").format.verticalAlignment = "center";
  dashboard.getRange("E13:H15").merge();
  dashboard.getRange("E13").values = [[
    "本市户籍 = 户口省份为上海市；非本市户籍 = 其他省份，以及空白、62 等异常值。",
  ]];
  dashboard.getRange("E13:H15").format.fill = "#F8FAFC";
  dashboard.getRange("E13:H15").format.font = { name: "Microsoft YaHei", size: 10, color: "#374151" };
  dashboard.getRange("E13:H15").format.horizontalAlignment = "left";
  dashboard.getRange("E13:H15").format.verticalAlignment = "top";
  dashboard.getRange("E13:H15").format.wrapText = true;
  dashboard.getRange("E13:H15").format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };

  // 年级统计
  gradeSheet.getRange("A1:I1").merge();
  gradeSheet.getRange("A1").values = [["年级统计"]];
  setBand(gradeSheet.getRange("A1:I1"), "#1D4ED8", { size: 16 });
  gradeSheet.getRange("A2:I2").merge();
  gradeSheet.getRange("A2").values = [[`按年级查看人数、性别、状态、少数民族和户籍构成。`]];
  gradeSheet.getRange("A2:I2").format.fill = "#EFF6FF";
  gradeSheet.getRange("A2:I2").format.font = { name: "Microsoft YaHei", size: 10, color: "#1E3A8A" };
  gradeSheet.getRange("A2:I2").format.horizontalAlignment = "left";
  gradeSheet.getRange("A2:I2").format.verticalAlignment = "center";
  gradeSheet.getRange("A2:I2").format.wrapText = true;
  gradeSheet.getRange("A5:I5").values = [[
    "年级", "人数", "男生", "女生", "在读", "休学", "少数民族", "本市户籍", "非本市户籍",
  ]];
  for (let i = 0; i < grades.length; i += 1) {
    const row = 6 + i;
    gradeSheet.getRange(`A${row}`).values = [[grades[i]]];
    gradeSheet.getRange(`B${row}`).formulas = [[`=COUNTIF('学生索引'!$B$2:$B$${rows.length + 1},A${row})`]];
    gradeSheet.getRange(`C${row}`).formulas = [[`=COUNTIFS('学生索引'!$B$2:$B$${rows.length + 1},A${row},'学生索引'!$D$2:$D$${rows.length + 1},"男性")`]];
    gradeSheet.getRange(`D${row}`).formulas = [[`=COUNTIFS('学生索引'!$B$2:$B$${rows.length + 1},A${row},'学生索引'!$D$2:$D$${rows.length + 1},"女性")`]];
    gradeSheet.getRange(`E${row}`).formulas = [[`=COUNTIFS('学生索引'!$B$2:$B$${rows.length + 1},A${row},'学生索引'!$E$2:$E$${rows.length + 1},"在读")`]];
    gradeSheet.getRange(`F${row}`).formulas = [[`=COUNTIFS('学生索引'!$B$2:$B$${rows.length + 1},A${row},'学生索引'!$E$2:$E$${rows.length + 1},"休学")`]];
    gradeSheet.getRange(`G${row}`).formulas = [[`=COUNTIFS('学生索引'!$B$2:$B$${rows.length + 1},A${row},'学生索引'!$I$2:$I$${rows.length + 1},"少数民族")`]];
    gradeSheet.getRange(`H${row}`).formulas = [[`=COUNTIFS('学生索引'!$B$2:$B$${rows.length + 1},A${row},'学生索引'!$H$2:$H$${rows.length + 1},"本市户籍")`]];
    gradeSheet.getRange(`I${row}`).formulas = [[`=COUNTIFS('学生索引'!$B$2:$B$${rows.length + 1},A${row},'学生索引'!$H$2:$H$${rows.length + 1},"非本市户籍")`]];
  }
  const gradeTotalRow = 6 + grades.length;
  gradeSheet.getRange(`A${gradeTotalRow}`).values = [["合计"]];
  gradeSheet.getRange(`B${gradeTotalRow}`).formulas = [[`=SUM(B6:B${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`C${gradeTotalRow}`).formulas = [[`=SUM(C6:C${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`D${gradeTotalRow}`).formulas = [[`=SUM(D6:D${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`E${gradeTotalRow}`).formulas = [[`=SUM(E6:E${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`F${gradeTotalRow}`).formulas = [[`=SUM(F6:F${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`G${gradeTotalRow}`).formulas = [[`=SUM(G6:G${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`H${gradeTotalRow}`).formulas = [[`=SUM(H6:H${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`I${gradeTotalRow}`).formulas = [[`=SUM(I6:I${gradeTotalRow - 1})`]];
  gradeSheet.getRange(`A5:I${gradeTotalRow}`).format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  setHeader(gradeSheet.getRange("A5:I5"), "#1D4ED8");
  gradeSheet.getRange(`A${gradeTotalRow}:I${gradeTotalRow}`).format.fill = "#DBEAFE";
  gradeSheet.getRange(`A${gradeTotalRow}:I${gradeTotalRow}`).format.font = { name: "Microsoft YaHei", size: 10, color: "#1E3A8A", bold: true };
  gradeSheet.getRange(`A6:A${gradeTotalRow}`).format.font = { name: "Microsoft YaHei", size: 10, color: "#111827" };
  gradeSheet.getRange(`A5:I${gradeTotalRow}`).format.horizontalAlignment = "center";
  gradeSheet.getRange(`A5:I${gradeTotalRow}`).format.verticalAlignment = "center";
  gradeSheet.getRange("A:A").format.columnWidthPx = 110;
  gradeSheet.getRange("B:I").format.columnWidthPx = 85;
  gradeSheet.getRange(`A5:I${gradeTotalRow}`).format.rowHeightPx = 24;
  gradeSheet.freezePanes.freezeRows(5);
  const gradeChart = gradeSheet.charts.add("bar", gradeSheet.getRange(`A5:B${gradeTotalRow - 1}`));
  gradeChart.title = "年级人数分布";
  gradeChart.hasLegend = false;
  gradeChart.setPosition("K5", "T20");
  gradeChart.xAxis = { axisType: "textAxis" };
  gradeChart.yAxis = { numberFormatCode: "0" };

  // 班级统计
  classSheet.getRange("A1:I1").merge();
  classSheet.getRange("A1").values = [["班级统计"]];
  setBand(classSheet.getRange("A1:I1"), "#7C3AED", { size: 16 });
  classSheet.getRange("A2:I2").merge();
  classSheet.getRange("A2").values = [[`按班级查看人数、性别、状态、少数民族和户籍构成。`]];
  classSheet.getRange("A2:I2").format.fill = "#F5F3FF";
  classSheet.getRange("A2:I2").format.font = { name: "Microsoft YaHei", size: 10, color: "#5B21B6" };
  classSheet.getRange("A2:I2").format.horizontalAlignment = "left";
  classSheet.getRange("A2:I2").format.verticalAlignment = "center";
  classSheet.getRange("A2:I2").format.wrapText = true;
  classSheet.getRange("A5:I5").values = [[
    "班级", "人数", "男生", "女生", "在读", "休学", "少数民族", "本市户籍", "非本市户籍",
  ]];
  for (let i = 0; i < classes.length; i += 1) {
    const row = 6 + i;
    classSheet.getRange(`A${row}`).values = [[classes[i]]];
    classSheet.getRange(`B${row}`).formulas = [[`=COUNTIF('学生索引'!$C$2:$C$${rows.length + 1},A${row})`]];
    classSheet.getRange(`C${row}`).formulas = [[`=COUNTIFS('学生索引'!$C$2:$C$${rows.length + 1},A${row},'学生索引'!$D$2:$D$${rows.length + 1},"男性")`]];
    classSheet.getRange(`D${row}`).formulas = [[`=COUNTIFS('学生索引'!$C$2:$C$${rows.length + 1},A${row},'学生索引'!$D$2:$D$${rows.length + 1},"女性")`]];
    classSheet.getRange(`E${row}`).formulas = [[`=COUNTIFS('学生索引'!$C$2:$C$${rows.length + 1},A${row},'学生索引'!$E$2:$E$${rows.length + 1},"在读")`]];
    classSheet.getRange(`F${row}`).formulas = [[`=COUNTIFS('学生索引'!$C$2:$C$${rows.length + 1},A${row},'学生索引'!$E$2:$E$${rows.length + 1},"休学")`]];
    classSheet.getRange(`G${row}`).formulas = [[`=COUNTIFS('学生索引'!$C$2:$C$${rows.length + 1},A${row},'学生索引'!$I$2:$I$${rows.length + 1},"少数民族")`]];
    classSheet.getRange(`H${row}`).formulas = [[`=COUNTIFS('学生索引'!$C$2:$C$${rows.length + 1},A${row},'学生索引'!$H$2:$H$${rows.length + 1},"本市户籍")`]];
    classSheet.getRange(`I${row}`).formulas = [[`=COUNTIFS('学生索引'!$C$2:$C$${rows.length + 1},A${row},'学生索引'!$H$2:$H$${rows.length + 1},"非本市户籍")`]];
  }
  const classTotalRow = 6 + classes.length;
  classSheet.getRange(`A${classTotalRow}`).values = [["合计"]];
  classSheet.getRange(`B${classTotalRow}`).formulas = [[`=SUM(B6:B${classTotalRow - 1})`]];
  classSheet.getRange(`C${classTotalRow}`).formulas = [[`=SUM(C6:C${classTotalRow - 1})`]];
  classSheet.getRange(`D${classTotalRow}`).formulas = [[`=SUM(D6:D${classTotalRow - 1})`]];
  classSheet.getRange(`E${classTotalRow}`).formulas = [[`=SUM(E6:E${classTotalRow - 1})`]];
  classSheet.getRange(`F${classTotalRow}`).formulas = [[`=SUM(F6:F${classTotalRow - 1})`]];
  classSheet.getRange(`G${classTotalRow}`).formulas = [[`=SUM(G6:G${classTotalRow - 1})`]];
  classSheet.getRange(`H${classTotalRow}`).formulas = [[`=SUM(H6:H${classTotalRow - 1})`]];
  classSheet.getRange(`I${classTotalRow}`).formulas = [[`=SUM(I6:I${classTotalRow - 1})`]];
  classSheet.getRange(`A5:I${classTotalRow}`).format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  setHeader(classSheet.getRange("A5:I5"), "#7C3AED");
  classSheet.getRange(`A${classTotalRow}:I${classTotalRow}`).format.fill = "#EDE9FE";
  classSheet.getRange(`A${classTotalRow}:I${classTotalRow}`).format.font = { name: "Microsoft YaHei", size: 10, color: "#5B21B6", bold: true };
  classSheet.getRange("A:A").format.columnWidthPx = 110;
  classSheet.getRange("B:I").format.columnWidthPx = 85;
  classSheet.getRange(`A5:I${classTotalRow}`).format.rowHeightPx = 24;
  classSheet.freezePanes.freezeRows(5);
  const classChart = classSheet.charts.add("bar", classSheet.getRange(`A5:B${classTotalRow - 1}`));
  classChart.title = "班级人数分布";
  classChart.hasLegend = false;
  classChart.setPosition("K5", "T24");
  classChart.xAxis = { axisType: "textAxis" };
  classChart.yAxis = { numberFormatCode: "0" };

  // 归档索引
  archiveSheet.getRange("A1:D1").values = [[
    "学年度", "学期", "归档文件", "说明",
  ]];
  archiveSheet.getRange("A2:D2").values = [[
    "2025学年度",
    "第二学期",
    `archive${path.sep}2025学年度${path.sep}2025年度.xlsx`,
    "当前源文件已归档。未来每学年可按同样路径新增一份年度原始表。",
  ]];
  archiveSheet.getRange("A1:D2").format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  setHeader(archiveSheet.getRange("A1:D1"), "#0F766E");
  archiveSheet.getRange("A2:D2").format.font = { name: "Microsoft YaHei", size: 10, color: "#111827" };
  archiveSheet.getRange("A2:D2").format.wrapText = true;
  archiveSheet.getRange("A:A").format.columnWidthPx = 120;
  archiveSheet.getRange("B:B").format.columnWidthPx = 90;
  archiveSheet.getRange("C:C").format.columnWidthPx = 200;
  archiveSheet.getRange("D:D").format.columnWidthPx = 300;
  archiveSheet.getRange("A1:D2").format.rowHeightPx = 26;

  // 说明
  noteSheet.getRange("A1:D1").values = [["更新说明", "", "", ""]];
  noteSheet.getRange("A1:D1").merge();
  setBand(noteSheet.getRange("A1:D1"), "#111827", { size: 16 });
  noteSheet.getRange("A2:D2").values = [[
    "1. 将每学年学籍 Excel 放入工作目录后重新运行生成脚本。 2. 脚本会自动归档原始文件到 archive/学年度/。 3. 看板默认展示 2025学年度第二学期数据。 4. 若源表中的户口省份出现空白或 62 等异常值，将直接计入“非本市户籍”。",
  ]];
  noteSheet.getRange("A2:D2").merge();
  noteSheet.getRange("A2:D2").format.fill = "#F3F4F6";
  noteSheet.getRange("A2:D2").format.font = { name: "Microsoft YaHei", size: 10, color: "#111827" };
  noteSheet.getRange("A2:D2").format.wrapText = true;
  noteSheet.getRange("A2:D2").format.verticalAlignment = "top";
  noteSheet.getRange("A2:D2").format.horizontalAlignment = "left";
  noteSheet.getRange("A1:D2").format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };
  noteSheet.getRange("A:A").format.columnWidthPx = 220;
  noteSheet.getRange("B:D").format.columnWidthPx = 120;
  noteSheet.getRange("A1:D2").format.rowHeightPx = 30;

  // 版式
  dashboard.getRange("A:N").format.columnWidthPx = 90;
  dashboard.getRange("A:A").format.columnWidthPx = 120;
  dashboard.getRange("B:B").format.columnWidthPx = 80;
  dashboard.getRange("C:C").format.columnWidthPx = 18;
  dashboard.getRange("D:E").format.columnWidthPx = 80;
  dashboard.getRange("F:F").format.columnWidthPx = 18;
  dashboard.getRange("G:H").format.columnWidthPx = 80;
  dashboard.getRange("I:I").format.columnWidthPx = 18;
  dashboard.getRange("J:K").format.columnWidthPx = 100;
  dashboard.getRange("L:L").format.columnWidthPx = 18;
  dashboard.getRange("M:N").format.columnWidthPx = 80;
  dashboard.getRange("A1:N15").format.rowHeightPx = 24;
  dashboard.freezePanes.freezeRows(3);

  const xlsx = await SpreadsheetFile.exportXlsx(wb);
  await xlsx.save(outputFile);
}

await main();
