const state = {
  data: null,
  year: "all",
  grade: "all",
  className: "all",
  search: "",
  detailSearch: "",
  detailGender: "all",
  detailStatus: "all",
  detailCity: "all",
  detailEthnicityRaw: "all",
  detailIdType: "all",
  detailClass: "all",
  detailEthnicity: "all",
  detailOpen: false,
  passwordOpen: false,
  importOpen: false,
  loading: false,
  token: localStorage.getItem("authToken") || "",
  username: localStorage.getItem("authUser") || "",
};

const els = {
  loginScreen: document.getElementById("loginScreen"),
  appShell: document.getElementById("appShell"),
  appStatus: document.getElementById("appStatus"),
  loginForm: document.getElementById("loginForm"),
  loginUser: document.getElementById("loginUser"),
  loginPass: document.getElementById("loginPass"),
  loginError: document.getElementById("loginError"),
  loginLogo: document.getElementById("loginLogo"),
  appLogo: document.getElementById("appLogo"),
  currentUser: document.getElementById("currentUser"),
  generatedAt: document.getElementById("generatedAt"),
  yearCount: document.getElementById("yearCount"),
  yearSelect: document.getElementById("yearSelect"),
  gradeSelect: document.getElementById("gradeSelect"),
  classSelect: document.getElementById("classSelect"),
  searchInput: document.getElementById("searchInput"),
  resetBtn: document.getElementById("resetBtn"),
  kpiGrid: document.getElementById("kpiGrid"),
  gradeChart: document.getElementById("gradeChart"),
  classChart: document.getElementById("classChart"),
  gradeSummary: document.getElementById("gradeSummary"),
  classSummary: document.getElementById("classSummary"),
  detailSummary: document.getElementById("detailSummary"),
  detailToggleBtn: document.getElementById("detailToggleBtn"),
  detailFilters: document.getElementById("detailFilters"),
  detailQuickBar: document.getElementById("detailQuickBar"),
  detailPanel: document.getElementById("detailPanel"),
  detailHint: document.getElementById("detailHint"),
  detailSearchInput: document.getElementById("detailSearchInput"),
  detailGenderSelect: document.getElementById("detailGenderSelect"),
  detailStatusSelect: document.getElementById("detailStatusSelect"),
  detailCitySelect: document.getElementById("detailCitySelect"),
  detailIdTypeSelect: document.getElementById("detailIdTypeSelect"),
  detailEthnicitySelect: document.getElementById("detailEthnicitySelect"),
  detailClassSelect: document.getElementById("detailClassSelect"),
  detailResetBtn: document.getElementById("detailResetBtn"),
  studentTbody: document.getElementById("studentTbody"),
  changePasswordBtn: document.getElementById("changePasswordBtn"),
  importRosterBtn: document.getElementById("importRosterBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  passwordOverlay: document.getElementById("passwordOverlay"),
  closePasswordBtn: document.getElementById("closePasswordBtn"),
  changePasswordForm: document.getElementById("changePasswordForm"),
  currentPassword: document.getElementById("currentPassword"),
  newPassword: document.getElementById("newPassword"),
  confirmPassword: document.getElementById("confirmPassword"),
  passwordMessage: document.getElementById("passwordMessage"),
  importOverlay: document.getElementById("importOverlay"),
  closeImportBtn: document.getElementById("closeImportBtn"),
  importRosterForm: document.getElementById("importRosterForm"),
  importFileInput: document.getElementById("importFileInput"),
  importTermInput: document.getElementById("importTermInput"),
  importTemplateLink: document.getElementById("importTemplateLink"),
  importMessage: document.getElementById("importMessage"),
  importSubmitBtn: document.getElementById("importSubmitBtn"),
};

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function yearNumber(label) {
  const match = String(label || "").match(/(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function latestYearLabel() {
  if (!state.data?.years?.length) return "all";
  return [...state.data.years].sort((a, b) => yearNumber(b.yearLabel) - yearNumber(a.yearLabel))[0].yearLabel;
}

function gradeOrder(text) {
  const match = String(text || "").match(/([一二三四五六七八九十]+)年级/);
  if (!match) return 99;
  const map = { һ: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, ʮ: 10 };
  return [...match[1]].reduce((n, ch) => n * 10 + (map[ch] ?? 0), 0);
}

function classOrder(text) {
  const grade = gradeOrder(text);
  const match = String(text || "").match(/(\d+)\s*班/);
  const classNo = match ? Number(match[1]) : 99;
  return grade * 100 + classNo;
}

function sortedGrades(rows) {
  return uniq(rows.map((row) => row.grade)).sort((a, b) => gradeOrder(a) - gradeOrder(b));
}

function sortedClasses(rows) {
  return uniq(rows.map((row) => row.className)).sort((a, b) => classOrder(a) - classOrder(b));
}

function sortedEthnicities(rows) {
  const collator = new Intl.Collator("zh-CN");
  return uniq(rows.map((row) => row.ethnicity)).sort((a, b) => collator.compare(a, b));
}

function setSession(token, username) {
  state.token = token;
  state.username = username;
  localStorage.setItem("authToken", token);
  localStorage.setItem("authUser", username);
}

function clearSession() {
  state.token = "";
  state.username = "";
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");
}

function authHeaders(extra = {}) {
  return state.token ? { ...extra, Authorization: `Bearer ${state.token}` } : extra;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders({
      "content-type": "application/json",
      ...(options.headers || {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function getActiveRows() {
  if (!state.data) return [];
  const years = state.year === "all" ? state.data.years : state.data.years.filter((year) => year.yearLabel === state.year);
  return years.flatMap((year) => year.rows.map((row) => ({ ...row, yearLabel: year.yearLabel })));
}

function getScopedRows() {
  let rows = getActiveRows();
  if (state.grade !== "all") rows = rows.filter((row) => row.grade === state.grade);
  if (state.className !== "all") rows = rows.filter((row) => row.className === state.className);
  return rows;
}

function getFilteredRows() {
  let rows = getActiveRows();
  if (state.grade !== "all") rows = rows.filter((row) => row.grade === state.grade);
  if (state.className !== "all") rows = rows.filter((row) => row.className === state.className);
  const query = state.search.trim();
  if (query) rows = rows.filter((row) => row.name.includes(query));
  return rows;
}

function getDetailFilteredRows(rows) {
  let result = rows;
  const query = state.detailSearch.trim();
  if (query) result = result.filter((row) => row.name.includes(query));
  if (state.detailGender !== "all") result = result.filter((row) => genderMatches(row.gender, state.detailGender));
  if (state.detailStatus !== "all") result = result.filter((row) => row.status === state.detailStatus);
  if (state.detailCity !== "all") result = result.filter((row) => row.cityStatus === state.detailCity);
  if (state.detailEthnicityRaw !== "all") result = result.filter((row) => row.ethnicity === state.detailEthnicityRaw);
  if (state.detailIdType !== "all") result = result.filter((row) => row.idType === state.detailIdType);
  if (state.detailClass !== "all") result = result.filter((row) => row.className === state.detailClass);
  if (state.detailEthnicity !== "all") result = result.filter((row) => row.ethnicityGroup === state.detailEthnicity);
  return result;
}

function genderMatches(gender, filterValue) {
  const value = String(gender || "");
  if (filterValue === "all") return true;
  if (filterValue === "男") return value.includes("男");
  if (filterValue === "女") return value.includes("女");
  return value === filterValue || value.includes(filterValue);
}

function countRows(rows) {
  const foreignCount = rows.filter((row) => row.ethnicityGroup === "外籍").length;
  return {
    total: rows.length,
    male: rows.filter((row) => genderMatches(row.gender, "男")).length,
    female: rows.filter((row) => genderMatches(row.gender, "女")).length,
    city: rows.filter((row) => row.cityStatus === "本市户籍").length,
    nonCity: rows.filter((row) => row.cityStatus !== "本市户籍" && row.ethnicityGroup !== "外籍").length,
    active: rows.filter((row) => row.status === "在读").length,
    suspended: rows.filter((row) => row.status === "休学").length,
    minority: rows.filter((row) => row.ethnicityGroup === "少数民族").length,
    foreign: foreignCount,
  };
}

function renderKpis(rows) {


  const c = countRows(rows);
  const cards = [
    ["总人数", c.total, "当前筛选范围内"],
    ["男生", c.male, "性别统计"],
    ["女生", c.female, "性别统计"],
    ["本市户籍", c.city, "户籍统计"],
    ["非本市户籍", c.nonCity, "户籍统计"],
    ["在读", c.active, "学籍状态"],
    ["休学", c.suspended, "学籍状态"],
    ["少数民族", c.minority, "民族统计"],
    ["外籍", c.foreign, "证件识别"],
  ];
  els.kpiGrid.innerHTML = cards
    .map(
      ([label, value, sub]) => `
        <article class="kpi">
          <div class="label">${label}</div>
          <div class="value">${formatCount(value)}</div>
          <div class="sub">${sub}</div>
        </article>
      `,
    )
    .join("");
}

function renderBars(container, rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  const items = [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  const max = items[0]?.[1] || 1;

  if (!items.length) {
    container.innerHTML = `<div class="muted">暂无数据</div>`;
    return;
  }

  container.innerHTML = items
    .map(
      ([label, count]) => `
        <div class="bar-row">
          <div class="bar-label">${label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div>
          <div class="bar-count">${count}</div>
        </div>
      `,
    )
    .join("");
}

function renderTable(rows) {
  els.studentTbody.innerHTML = rows
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${row.name}</td>
          <td>${row.yearLabel}</td>
          <td>${row.grade}</td>
          <td>${row.className}</td>
          <td>${row.gender}</td>
          <td>${row.status}</td>
          <td>${row.cityStatus}</td>
          <td>${row.idType}</td>
          <td>${row.ethnicity}</td>
          <td>${row.ethnicityGroup}</td>
        </tr>
      `,
    )
    .join("");
}

function getYearRowsForSelect() {
  if (!state.data) return [];
  if (state.year === "all") return state.data.years.flatMap((year) => year.rows.map((row) => ({ ...row, yearLabel: year.yearLabel })));
  const year = state.data.years.find((item) => item.yearLabel === state.year);
  return (year?.rows || []).map((row) => ({ ...row, yearLabel: year?.yearLabel || state.year }));
}

function syncOptions() {
  const yearRows = getYearRowsForSelect();
  const grades = sortedGrades(yearRows);
  const currentGrade = state.grade;
  const currentClass = state.className;

  els.gradeSelect.innerHTML = [`<option value="all">全部年级</option>`, ...grades.map((grade) => `<option value="${grade}">${grade}</option>`)].join("");
  els.gradeSelect.value = grades.includes(currentGrade) || currentGrade === "all" ? currentGrade : "all";
  state.grade = els.gradeSelect.value;

  const classSource = state.grade === "all" ? yearRows : yearRows.filter((row) => row.grade === state.grade);
  const classes = sortedClasses(classSource);
  els.classSelect.innerHTML = [`<option value="all">全部班级</option>`, ...classes.map((className) => `<option value="${className}">${className}</option>`)].join("");
  els.classSelect.value = classes.includes(currentClass) || currentClass === "all" ? currentClass : "all";
  state.className = els.classSelect.value;

  if (els.detailClassSelect) {
    els.detailClassSelect.innerHTML = [`<option value="all">全部班级</option>`, ...classes.map((className) => `<option value="${className}">${className}</option>`)].join("");
    els.detailClassSelect.value = classes.includes(state.detailClass) || state.detailClass === "all" ? state.detailClass : "all";
    state.detailClass = els.detailClassSelect.value;
  }

  if (els.detailEthnicitySelect) {
    const ethnicityRows = getScopedRows();
    const ethnicities = sortedEthnicities(ethnicityRows);
    els.detailEthnicitySelect.innerHTML = [`<option value="all">全部民族</option>`, ...ethnicities.map((ethnicity) => `<option value="${ethnicity}">${ethnicity}</option>`)].join("");
    els.detailEthnicitySelect.value = ethnicities.includes(state.detailEthnicityRaw) || state.detailEthnicityRaw === "all" ? state.detailEthnicityRaw : "all";
    state.detailEthnicityRaw = els.detailEthnicitySelect.value;
  }

  if (els.detailIdTypeSelect) {
    const idTypes = uniq(yearRows.map((row) => row.idType)).sort(new Intl.Collator("zh-CN").compare);
    els.detailIdTypeSelect.innerHTML = [`<option value="all">全部证件类型</option>`, ...idTypes.map((idType) => `<option value="${idType}">${idType}</option>`)].join("");
    els.detailIdTypeSelect.value = idTypes.includes(state.detailIdType) || state.detailIdType === "all" ? state.detailIdType : "all";
    state.detailIdType = els.detailIdTypeSelect.value;
  }
}

function renderMeta() {
  if (els.currentUser) els.currentUser.textContent = state.username || "admin";
  els.yearSelect.innerHTML = [
    `<option value="all">全部学年度</option>`,
    ...state.data.years.map((year) => `<option value="${year.yearLabel}">${year.yearLabel}</option>`),
  ].join("");
  els.yearSelect.value = state.year;
}

function setAppStatus(message = "", kind = "info") {
  if (!els.appStatus) return;
  if (!message) {
    els.appStatus.hidden = true;
    els.appStatus.textContent = "";
    els.appStatus.dataset.kind = "";
    return;
  }
  els.appStatus.hidden = false;
  els.appStatus.textContent = message;
  els.appStatus.dataset.kind = kind;
}

function showApp() {
  closePasswordPanel();
  closeImportPanel();
  els.loginScreen.hidden = true;
  els.appShell.hidden = false;
}

function showLogin(message = "") {
  closePasswordPanel();
  closeImportPanel();
  els.loginScreen.hidden = false;
  els.appShell.hidden = true;
  els.loginError.textContent = message;
}

function openPasswordPanel() {
  state.passwordOpen = true;
  els.passwordOverlay.hidden = false;
  els.currentPassword.value = "";
  els.newPassword.value = "";
  els.confirmPassword.value = "";
  els.passwordMessage.textContent = "";
  setTimeout(() => els.currentPassword.focus(), 0);
}

function closePasswordPanel() {
  state.passwordOpen = false;
  els.passwordOverlay.hidden = true;
}

function openImportPanel() {
  state.importOpen = true;
  els.importOverlay.hidden = false;
  els.importMessage.textContent = "";
  els.importRosterForm.reset();
  setTimeout(() => els.importFileInput.focus(), 0);
}

function closeImportPanel() {
  state.importOpen = false;
  els.importOverlay.hidden = true;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function resetDetailFilters() {
  state.detailSearch = "";
  state.detailGender = "all";
  state.detailStatus = "all";
  state.detailCity = "all";
  state.detailEthnicityRaw = "all";
  state.detailIdType = "all";
  state.detailClass = "all";
  state.detailEthnicity = "all";
  els.detailSearchInput.value = "";
  els.detailGenderSelect.value = "all";
  els.detailStatusSelect.value = "all";
  els.detailCitySelect.value = "all";
  if (els.detailEthnicitySelect) els.detailEthnicitySelect.value = "all";
  if (els.detailIdTypeSelect) els.detailIdTypeSelect.value = "all";
  if (els.detailClassSelect) els.detailClassSelect.value = "all";
}

function syncDetailQuickState() {
  if (!els.detailQuickBar) return;
  const buttons = els.detailQuickBar.querySelectorAll("button[data-detail-filter]");
  buttons.forEach((button) => {
    const filter = button.dataset.detailFilter;
    const value = button.dataset.detailValue;
    let active = false;
    if (filter === "gender") active = state.detailGender === value;
    if (filter === "status") active = state.detailStatus === value;
    if (filter === "city") active = state.detailCity === value;
    if (filter === "ethnicity") active = state.detailEthnicity === value;
    if (filter === "reset") {
      active =
      state.detailSearch === "" &&
      state.detailGender === "all" &&
      state.detailStatus === "all" &&
      state.detailCity === "all" &&
      state.detailEthnicityRaw === "all" &&
      state.detailIdType === "all" &&
      state.detailEthnicity === "all";
    }
    button.classList.toggle("is-active", active);
  });
}

function resetFilters() {
  state.year = latestYearLabel();
  state.grade = "all";
  state.className = "all";
  state.search = "";
  state.detailOpen = false;
  els.searchInput.value = "";
  resetDetailFilters();
  syncOptions();
  render();
}

function render() {
  const rows = getFilteredRows();
  const detailRows = getDetailFilteredRows(rows);
  renderKpis(rows);
  els.gradeSummary.textContent = `${formatCount(rows.length)} 人`;
  els.classSummary.textContent = state.className === "all" ? "按当前筛选汇总" : state.className;
  els.detailSummary.textContent = `${formatCount(detailRows.length)} 名学生`;
  renderBars(els.gradeChart, rows, (row) => row.grade);
  renderBars(els.classChart, rows, (row) => row.className);

  if (state.detailOpen) {
    renderTable(detailRows);
    els.detailPanel.hidden = false;
    els.detailFilters.hidden = false;
    els.detailQuickBar.hidden = false;
    els.detailToggleBtn.textContent = "收起查看";
    els.detailHint.hidden = true;
  } else {
    els.detailPanel.hidden = true;
    els.detailFilters.hidden = true;
    els.detailQuickBar.hidden = true;
    els.detailToggleBtn.textContent = "展开查看";
    els.detailHint.hidden = false;
  }

  syncDetailQuickState();
}

async function loadDataAndRender({ resetSelection = true } = {}) {
  setAppStatus("正在加载学籍数据，请稍候...");
  state.loading = true;
  try {
    const resp = await api("/api/data");
    state.data = resp;

    if (!state.data.years.length) {
      setAppStatus("未找到可用的学籍数据文件。", "error");
      return;
    }

    if (resetSelection || state.year === "all" || !state.data.years.some((year) => year.yearLabel === state.year)) {
      state.year = latestYearLabel();
      state.grade = "all";
      state.className = "all";
      state.search = "";
      state.detailOpen = false;
      els.searchInput.value = "";
      resetDetailFilters();
    }

    renderMeta();
    syncOptions();
    render();
    setAppStatus(`已加载 ${state.data.years.length} 个学年度的数据。`);
  } catch (error) {
    setAppStatus(`数据加载失败：${error.message}`, "error");
    throw error;
  } finally {
    state.loading = false;
  }
}

async function activateSession() {
  showApp();
  setAppStatus("正在验证登录状态...");
  const me = await api("/api/me");
  state.username = me.username;
  try {
    await loadDataAndRender();
  } catch (error) {
    setAppStatus(`登录已验证，但数据加载失败：${error.message}`, "error");
  }
}

function bindEvents() {
  els.yearSelect.addEventListener("change", () => {
    state.year = els.yearSelect.value;
    state.grade = "all";
    state.className = "all";
    syncOptions();
    render();
  });

  els.gradeSelect.addEventListener("change", () => {
    state.grade = els.gradeSelect.value;
    state.className = "all";
    syncOptions();
    render();
  });

  els.classSelect.addEventListener("change", () => {
    state.className = els.classSelect.value;
    render();
  });

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value;
    render();
  });

  els.detailSearchInput.addEventListener("input", () => {
    state.detailSearch = els.detailSearchInput.value;
    render();
  });

  els.detailGenderSelect.addEventListener("change", () => {
    state.detailGender = els.detailGenderSelect.value;
    render();
  });

  els.detailStatusSelect.addEventListener("change", () => {
    state.detailStatus = els.detailStatusSelect.value;
    render();
  });

  els.detailCitySelect.addEventListener("change", () => {
    state.detailCity = els.detailCitySelect.value;
    render();
  });

  els.detailIdTypeSelect.addEventListener("change", () => {
    state.detailIdType = els.detailIdTypeSelect.value;
    render();
  });

  els.detailEthnicitySelect.addEventListener("change", () => {
    state.detailEthnicityRaw = els.detailEthnicitySelect.value;
    render();
  });

  els.detailClassSelect.addEventListener("change", () => {
    state.detailClass = els.detailClassSelect.value;
    render();
  });

  els.resetBtn.addEventListener("click", resetFilters);

  els.detailResetBtn.addEventListener("click", () => {
    resetDetailFilters();
    render();
  });

  els.detailQuickBar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-detail-filter]");
    if (!button) return;
    const filter = button.dataset.detailFilter;
    const value = button.dataset.detailValue;

    if (filter === "reset") {
      resetDetailFilters();
      render();
      return;
    }

    if (filter === "gender") {
      state.detailGender = state.detailGender === value ? "all" : value;
      els.detailGenderSelect.value = state.detailGender;
    } else if (filter === "status") {
      state.detailStatus = state.detailStatus === value ? "all" : value;
      els.detailStatusSelect.value = state.detailStatus;
    } else if (filter === "city") {
      state.detailCity = state.detailCity === value ? "all" : value;
      els.detailCitySelect.value = state.detailCity;
    } else if (filter === "ethnicity") {
      state.detailEthnicity = state.detailEthnicity === value ? "all" : value;
    }

    render();
  });

  els.detailToggleBtn.addEventListener("click", () => {
    state.detailOpen = !state.detailOpen;
    render();
  });

  els.changePasswordBtn.addEventListener("click", openPasswordPanel);
  els.importRosterBtn.addEventListener("click", () => {
    closePasswordPanel();
    openImportPanel();
  });
  els.closePasswordBtn.addEventListener("click", closePasswordPanel);
  els.passwordOverlay.addEventListener("click", (event) => {
    if (event.target === els.passwordOverlay) closePasswordPanel();
  });
  els.closeImportBtn.addEventListener("click", closeImportPanel);
  els.importOverlay.addEventListener("click", (event) => {
    if (event.target === els.importOverlay) closeImportPanel();
  });

  els.logoutBtn.addEventListener("click", () => {
    clearSession();
    state.data = null;
    state.detailOpen = false;
    closePasswordPanel();
    closeImportPanel();
    setAppStatus("");
    showLogin("已退出登录");
  });

  els.changePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      els.passwordMessage.textContent = "";
      await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: els.currentPassword.value,
          newPassword: els.newPassword.value,
          confirmPassword: els.confirmPassword.value,
        }),
      });
      clearSession();
      state.data = null;
      state.detailOpen = false;
      closePasswordPanel();
      closeImportPanel();
      setAppStatus("");
      showLogin("密码已更新，请使用新密码重新登录。");
    } catch (error) {
      els.passwordMessage.textContent = error.message;
    }
  });

  els.importRosterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.importMessage.textContent = "";

    const file = els.importFileInput.files?.[0];
    const termInput = els.importTermInput.value.trim();
    if (!file) {
      els.importMessage.textContent = "请选择要导入的 Excel 文件。";
      return;
    }
    if (!termInput) {
      els.importMessage.textContent = "请填写学年度学期，例如：2025学年度第二学期。";
      return;
    }

    const submitButton = els.importSubmitBtn;
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "导入中...";
    try {
      const fileBuffer = await file.arrayBuffer();
      const result = await api("/api/import-roster", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: arrayBufferToBase64(fileBuffer),
          termInput,
        }),
      });
      closeImportPanel();
      setAppStatus(`已导入 ${result.termLabel}，共 ${formatCount(result.rowCount)} 名学生，其中外籍 ${formatCount(result.foreignCount)} 名。`);
      await loadDataAndRender({ resetSelection: true });
    } catch (error) {
      els.importMessage.textContent = error.message;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText || "上传并导入";
    }
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.loginError.textContent = "";
    const submitButton = els.loginForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    try {
      const username = els.loginUser.value.trim();
      const password = els.loginPass.value;
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
        headers: {},
      });
      setSession(result.token, result.username);
      showApp();
      try {
        await loadDataAndRender();
      } catch (error) {
        setAppStatus(`登录成功，但数据加载失败：${error.message}`, "error");
      }
    } catch (error) {
      showLogin(error.message);
    } finally {
      submitButton.disabled = false;
    }
  });
}

async function bootstrap() {
  if (els.loginLogo) els.loginLogo.src = "/assets/logo.png";
  if (els.appLogo) els.appLogo.src = "/assets/logo.png";

  bindEvents();
  showLogin();

  if (state.token) {
    try {
      await activateSession();
      return;
    } catch {
      clearSession();
      showLogin("登录已失效，请重新登录。");
    }
  }
}

bootstrap().catch((error) => {
  document.body.innerHTML = `<pre style="white-space:pre-wrap;padding:24px;color:#fecaca">加载失败：${error.message}</pre>`;
});
