/* app.js */

const worker = new Worker("worker.js");
let currentData = null; // Store latest data for export
let charts = {};
let currentTableId = "fyTable";

/* ===============================
   UI ELEMENTS
   =============================== */
const els = {
    parseInfo: document.getElementById("parseInfo"),
    app: document.getElementById("app"),
    aggSelect: document.getElementById("aggSelect"),
    fySelect: document.getElementById("fySelect"),
    useRange: document.getElementById("useRange"),
    fromMonth: document.getElementById("fromMonth"),
    toMonth: document.getElementById("toMonth"),
    consultantSelect: document.getElementById("consultantSelect"),
    providerSelect: document.getElementById("providerSelect"),
    rememberFilters: document.getElementById("rememberFilters"),
    resetBtn: document.getElementById("resetBtn"),
    exportBtn: document.getElementById("exportBtn"),
    // KPIs
    kpiTotalAll: document.getElementById("kpiTotalAll"),
    kpiSelPeriod: document.getElementById("kpiSelPeriod"),
    kpiLastFY: document.getElementById("kpiLastFY"),
    kpiYTD: document.getElementById("kpiYTD"),
    kpiYTDLabel: document.getElementById("kpiYTDLabel"),
    kpiLastFY_YTD_Detail: document.getElementById("kpiLastFY_YTD_Detail"),
    kpiProjection: document.getElementById("kpiProjection"),
    kpiPoP: document.getElementById("kpiPoP"),
    // Tables
    fyTableBody: document.querySelector("#fyTable tbody"),
    providerTableBody: document.querySelector("#providerTable tbody"),
    consultantTableBody: document.querySelector("#consultantTable tbody"),
    consultantDetailTableBody: document.querySelector("#consultantDetailTable tbody"),
    underTableBody: document.querySelector("#underTable tbody"),
    projectionTableBody: document.querySelector("#projectionTable tbody"),
    fyCompareTableBody: document.querySelector("#fyCompareTable tbody"),
    arContent: document.getElementById("arContent"),
    oldMisContent: document.getElementById("oldMisContent")
};

/* ===============================
   WORKER COMMUNICATION
   =============================== */
worker.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === "DATA_LOADED") {
        els.parseInfo.innerHTML = `<span class="ok">✓ Loaded ${payload.count} rows</span>`;
        initFilters(payload.filters);
        els.app.classList.remove("hidden");
        triggerFilter();
    } else if (type === "RENDER_DATA") {
        currentData = payload;
        renderUI(payload);
    } else if (type === "ERROR") {
        els.parseInfo.innerHTML = `<span class="warn">⚠ Error: ${payload}</span>`;
        els.parseInfo.classList.remove("hidden");
    }
};

// Start loading
els.parseInfo.classList.remove("hidden");
els.parseInfo.innerHTML = "<span class='animate-pulse'>⏳ Loading data...</span>";
worker.postMessage({ type: "INIT" });

/* ===============================
   FILTERS & EVENTS
   =============================== */
function initFilters(filters) {
    const { allMonths, allFYs, allCons, allProv } = filters;

    els.fySelect.innerHTML = allFYs.map(f => `<option>${f}</option>`).join("");
    els.fromMonth.innerHTML = allMonths.map(m => `<option value="${m}">${prettyMonth(m)}</option>`).join("");
    els.toMonth.innerHTML = els.fromMonth.innerHTML;
    els.consultantSelect.innerHTML = allCons.map(c => `<option>${c}</option>`).join("");
    els.providerSelect.innerHTML = allProv.map(c => `<option>${c}</option>`).join("");

    // Restore or Default
    const saved = JSON.parse(localStorage.getItem("gs_filters") || "null");
    const latest = allMonths[allMonths.length - 1];
    const defaultFY = fyLabelFromDate(new Date(latest + "-01"));

    if (saved) {
        els.aggSelect.value = saved.agg;
        els.fySelect.value = saved.fy;
        els.useRange.checked = saved.range;
        els.fromMonth.value = saved.from;
        els.toMonth.value = saved.to;
        els.consultantSelect.value = saved.cons;
        els.providerSelect.value = saved.prov;
        els.rememberFilters.checked = true;
        els.fromMonth.disabled = !els.useRange.checked;
        els.toMonth.disabled = !els.useRange.checked;
    } else {
        els.fySelect.value = defaultFY;
        els.useRange.checked = false;
        els.fromMonth.disabled = true;
        els.toMonth.disabled = true;
        els.consultantSelect.value = "All";
        els.providerSelect.value = "All";
        // Set default range to FY months if possible, else just first/last
        els.fromMonth.value = allMonths[0];
        els.toMonth.value = latest;
    }
}

function triggerFilter() {
    const filters = {
        agg: els.aggSelect.value,
        fy: els.fySelect.value,
        range: els.useRange.checked,
        from: els.fromMonth.value,
        to: els.toMonth.value,
        cons: els.consultantSelect.value,
        prov: els.providerSelect.value,
        allMonths: Array.from(els.fromMonth.options).map(o => o.value) // Pass all months for range check
    };

    if (els.rememberFilters.checked) {
        localStorage.setItem("gs_filters", JSON.stringify(filters));
    }

    worker.postMessage({ type: "FILTER", payload: filters });
}

[
    els.aggSelect, els.fySelect, els.useRange, els.fromMonth, els.toMonth,
    els.consultantSelect, els.providerSelect, els.rememberFilters
].forEach(el => {
    el.addEventListener("change", () => {
        if (el === els.useRange) {
            els.fromMonth.disabled = !els.useRange.checked;
            els.toMonth.disabled = !els.useRange.checked;
        }
        triggerFilter();
    });
});

els.resetBtn.addEventListener("click", () => {
    localStorage.removeItem("gs_filters");
    location.reload();
});

/* ===============================
   RENDERING
   =============================== */
function renderUI(data) {
    const { kpis, charts: chartData, tables, ar } = data;

    // KPIs
    els.kpiSelPeriod.textContent = fmtMoney(kpis.selPeriod);
    els.kpiTotalAll.textContent = fmtMoney(kpis.totalAll);
    els.kpiLastFY.textContent = fmtMoney(kpis.lastFY);
    els.kpiYTD.innerHTML = `${fmtMoney(kpis.ytd.this)} <span class="badge" style="background:${kpis.ytd.delta >= 0 ? '#16653433' : '#991b1b33'}">${kpis.ytd.delta == null ? 'n/a' : (kpis.ytd.delta >= 0 ? '+' : '') + kpis.ytd.delta.toFixed(1)}%</span>`;
    els.kpiYTDLabel.textContent = `YTD (${kpis.ytd.k} mo)`;
    els.kpiLastFY_YTD_Detail.textContent = `Last FY YTD: ${fmtMoney(kpis.ytd.last)}`;
    els.kpiProjection.textContent = fmtMoney(kpis.projection);
    els.kpiPoP.innerHTML = `${fmtMoney(kpis.pop.current)} <span class="badge" style="background:${kpis.pop.delta >= 0 ? '#16653433' : '#991b1b33'}">${kpis.pop.delta == null ? 'n/a' : (kpis.pop.delta >= 0 ? '+' : '') + kpis.pop.delta.toFixed(1)}% ${kpis.pop.label}</span>`;

    // Tables
    renderTable(els.fyTableBody, tables.fy, ["label", "sales", "coe", "avg", "count"], [null, fmtMoney, null, fmtMoney, null]);
    renderTable(els.providerTableBody, tables.provider, ["label", "sales", "coe", "share"], [fmtMoney, null, (v) => v.toFixed(1) + "%"]);
    renderTable(els.consultantTableBody, tables.consultant, ["label", "sales", "coe", "share"], [fmtMoney, null, (v) => v.toFixed(1) + "%"]);
    renderTable(els.underTableBody, tables.underperformers, ["name", "sales", "pct"], [fmtMoney, (v) => v.toFixed(0) + "%"]);
    renderTable(els.fyCompareTableBody, tables.fyCompare, ["label", "sales"], [fmtMoney]);

    // Consultant Detail
    els.consultantDetailTableBody.innerHTML = "";
    let totals = { t_coe: 0, t_sales: 0, he_coe: 0, he_sales: 0, vet_coe: 0, vet_sales: 0, py_coe: 0, py_sales: 0 };
    Object.keys(tables.detail).forEach(c => {
        const d = tables.detail[c];
        totals.t_coe += d.t_coe; totals.t_sales += d.t_sales;
        totals.he_coe += d.he_coe; totals.he_sales += d.he_sales;
        totals.vet_coe += d.vet_coe; totals.vet_sales += d.vet_sales;
        totals.py_coe += d.py_coe; totals.py_sales += d.py_sales;
        els.consultantDetailTableBody.innerHTML += `<tr><td>${c}</td><td>${d.t_coe}</td><td>${fmtMoney(d.t_sales)}</td><td>${d.he_coe}</td><td>${fmtMoney(d.he_sales)}</td><td>${d.vet_coe}</td><td>${fmtMoney(d.vet_sales)}</td><td>${d.py_coe}</td><td>${fmtMoney(d.py_sales)}</td></tr>`;
    });
    els.consultantDetailTableBody.innerHTML += `<tr style="font-weight:bold; border-top:2px solid #666;"><td>Total</td><td>${totals.t_coe}</td><td>${fmtMoney(totals.t_sales)}</td><td>${totals.he_coe}</td><td>${fmtMoney(totals.he_sales)}</td><td>${totals.vet_coe}</td><td>${fmtMoney(totals.vet_sales)}</td><td>${totals.py_coe}</td><td>${fmtMoney(totals.py_sales)}</td></tr>`;

    // Projection Table
    els.projectionTableBody.innerHTML = "";
    chartData.projection.labels.forEach((l, i) => {
        els.projectionTableBody.innerHTML += `<tr><td>${l}</td><td>${fmtMoney(chartData.projection.actual[i])}</td><td>${fmtMoney(chartData.projection.projected[i])}</td></tr>`;
    });

    // AR
    renderAR(ar);

    // Old MIS
    renderOldMIS(data);

    // Charts
    updateChart("monthly", "chartMonthly", "bar", chartData.monthly.labels, [{ label: "Net Sales", data: chartData.monthly.data }]);
    updateChart("provider", "chartProvider", "bar", chartData.provider.labels, [{ label: "Net Sales", data: chartData.provider.data }]);
    updateChart("providerPie", "chartProviderPie", "doughnut", chartData.provider.labels, [{ data: chartData.provider.data }]);
    updateChart("consultant", "chartConsultant", "bar", chartData.consultant.labels, [{ label: "Net Sales", data: chartData.consultant.data }], { indexAxis: "y" });
    updateChart("consultantPie", "chartConsultantPie", "doughnut", chartData.consultant.labels, [{ data: chartData.consultant.data }]);
    updateChart("projection", "chartProjection", "bar", chartData.projection.labels, [
        { label: "Actual", data: chartData.projection.actual, order: 1 },
        { label: "Projected", data: chartData.projection.projected, order: 2 }
    ]);
    updateChart("fy", "chartFY", "bar", chartData.fy.labels, [{ label: "FY Total Sales", data: chartData.fy.data }]);
}

function renderTable(tbody, data, keys, formatters = []) {
    tbody.innerHTML = "";
    data.forEach(row => {
        let html = "<tr>";
        keys.forEach((k, i) => {
            let val = row[k];
            if (formatters[i]) val = formatters[i](val);
            else if (typeof val === "number") val = val.toLocaleString(); // Default number fmt
            html += `<td>${val}</td>`;
        });
        html += "</tr>";
        tbody.innerHTML += html;
    });
}

function renderAR(arData) {
    els.arContent.innerHTML = "";
    const buckets = [
        { key: "not_due", label: "Not Due" },
        { key: "upto_30", label: "Up to 30 Days" },
        { key: "more_30", label: "31–60 Days" },
        { key: "more_60", label: "61–90 Days" },
        { key: "more_90", label: "90+ Days" },
        { key: "total", label: "Total Receivable" }
    ];

    const render = (data, title) => {
        if (!data) return `<div class="card mb-6 p-4 text-slate-400">Loading ${title}...</div>`;
        const total = data.total || 0;
        let html = `<h2 class="text-xl font-semibold mb-3">${title}</h2><div class="card mb-6 overflow-x-auto"><table class="table"><thead><tr><th>Aging Bucket</th><th>Amount (NPR)</th><th>% of Total</th></tr></thead><tbody>`;
        buckets.forEach(b => {
            const val = data[b.key] || 0;
            const pct = total ? ((val / total) * 100).toFixed(1) : "0.0";
            html += `<tr><td>${b.label}</td><td>${fmtMoney(val)}</td><td>${pct}%</td></tr>`;
        });
        html += `</tbody></table></div>`;
        return html;
    };

    els.arContent.innerHTML += render(arData.admission, "Admission Receivable");
    els.arContent.innerHTML += render(arData.migration, "Migration Receivable");
}

function renderOldMIS(data) {
    const { mis, kpis, tables, ar } = data;
    const container = els.oldMisContent;
    container.innerHTML = "";

    if (!mis || !mis.periods || mis.periods.length === 0) {
        container.innerHTML = `<div class="card p-8 text-center text-slate-400">No Old MIS data for selected period</div>`;
        return;
    }

    // --- Helper to get provider sales ---
    const getProvSale = (label) => {
        const row = tables.provider.find(r => r.label === label);
        return row ? row.sales : 0;
    };

    // --- TOP SECTION ---
    const topSection = document.createElement("div");
    topSection.className = "grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8";

    // 1. Admission Business
    const cardBiz = document.createElement("div");
    cardBiz.className = "card p-4";
    cardBiz.innerHTML = `
        <h3 class="font-bold text-lg mb-3 border-b border-slate-700 pb-2">Admission Business</h3>
        <div class="space-y-2 text-sm">
            <div class="flex justify-between bg-red-900/20 p-2 rounded">
                <span>Total Sales Till Date</span>
                <span class="font-bold">${fmtMoney(kpis.totalAll)}</span>
            </div>
            <div class="flex justify-between bg-red-900/20 p-2 rounded">
                <span>Sales of Selected Period</span>
                <span class="font-bold">${fmtMoney(kpis.selPeriod)}</span>
            </div>
            <div class="mt-4 font-semibold text-slate-300">Estimated Total Receivables</div>
            <div class="flex justify-between pl-4"><span>HE - Private</span> <span>${fmtMoney(getProvSale("HE - Private"))}</span></div>
            <div class="flex justify-between pl-4"><span>HE - Public</span> <span>${fmtMoney(getProvSale("HE - Public"))}</span></div>
            <div class="flex justify-between pl-4"><span>VET</span> <span>${fmtMoney(getProvSale("VET"))}</span></div>
            <div class="flex justify-between pl-4"><span>PY Provider</span> <span>${fmtMoney(getProvSale("PY"))}</span></div>
        </div>
    `;

    // 2. AR Summary
    const cardAR = document.createElement("div");
    cardAR.className = "card p-4";
    const admRec = ar.admission ? ar.admission.total : 0;
    const migRec = ar.migration ? ar.migration.total : 0;
    cardAR.innerHTML = `
        <h3 class="font-bold text-lg mb-3 border-b border-slate-700 pb-2">Receivable Summary</h3>
        <div class="space-y-2 text-sm">
            <div class="flex justify-between bg-orange-900/20 p-2 rounded">
                <span>Admission Receivable</span>
                <span class="font-bold">${fmtMoney(admRec)}</span>
            </div>
            <div class="flex justify-between p-2">
                <span>Insurance Receivable</span>
                <span>0</span>
            </div>
            <div class="mt-4 font-semibold text-slate-300">Migration Clients:</div>
            <div class="flex justify-between pl-4 bg-orange-900/20 p-2 rounded">
                <span>Receivable</span>
                <span class="font-bold">${fmtMoney(migRec)}</span>
            </div>
             <div class="flex justify-between pl-4 p-2">
                <span>Advance</span>
                <span>0</span>
            </div>
        </div>
    `;

    // 3. Admission Ageing
    const cardAgeing = document.createElement("div");
    cardAgeing.className = "card p-4";
    let ageingHtml = `<h3 class="font-bold text-lg mb-3 border-b border-slate-700 pb-2">Admission Receivable Ageing</h3>`;
    if (ar.admission) {
        const buckets = [
            { key: "more_90", label: "More than 90 days" },
            { key: "more_60", label: "More than 60 days" },
            { key: "more_30", label: "More than 30 days" },
            { key: "upto_30", label: "Up to 30 days" },
            { key: "not_due", label: "Not due" },
            { key: "total", label: "Total" }
        ];
        ageingHtml += `<table class="w-full text-sm text-right"><thead><tr class="text-slate-400"><th>Age</th><th>Amount</th><th>%</th></tr></thead><tbody>`;
        buckets.forEach(b => {
            const val = ar.admission[b.key] || 0;
            const pct = admRec ? ((val / admRec) * 100).toFixed(1) : "0.0";
            ageingHtml += `<tr class="border-b border-slate-800">
                <td class="text-left py-1">${b.label}</td>
                <td class="py-1">${fmtMoney(val)}</td>
                <td class="py-1">${pct}%</td>
            </tr>`;
        });
        ageingHtml += `</tbody></table>`;
    } else {
        ageingHtml += `<div class="text-slate-400">No Data</div>`;
    }
    cardAgeing.innerHTML = ageingHtml;

    topSection.appendChild(cardBiz);
    topSection.appendChild(cardAR);
    topSection.appendChild(cardAgeing);
    container.appendChild(topSection);


    // --- MIDDLE SECTION (MIS Table) ---
    const { periods, favourable, moderate, invoiced, received } = mis;
    const misSection = document.createElement("div");
    misSection.className = "card overflow-x-auto mb-8";
    misSection.innerHTML = `
      <h3 class="font-bold text-lg mb-3 p-4 pb-0">Expected Receivable - Period</h3>
      <table class="table">
        <thead>
          <tr>
            <th>Scenario</th>
            ${periods.map(p => `<th>${p}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Favourable Scenario</td>
            ${favourable.map(v => `<td>${fmtMoney(v)}</td>`).join("")}
          </tr>
          <tr>
            <td>Moderate Scenario</td>
            ${moderate.map(v => `<td>${fmtMoney(v)}</td>`).join("")}
          </tr>
          <tr class="bg-green-900/20">
            <td>Actual Invoiced</td>
            ${invoiced.map(v => `<td>${v ? fmtMoney(v) : "NA"}</td>`).join("")}
          </tr>
          <tr class="bg-green-900/20">
            <td>Actual Received</td>
            ${received.map(v => `<td>${v ? fmtMoney(v) : "NA"}</td>`).join("")}
          </tr>
        </tbody>
      </table>
    `;
    container.appendChild(misSection);


    // --- BOTTOM SECTION (Consultant Detail) ---
    const bottomSection = document.createElement("div");
    bottomSection.className = "card overflow-x-auto";
    bottomSection.innerHTML = `<h3 class="font-bold text-lg mb-3 p-4 pb-0">Admission Sales Breakdown</h3>`;

    // Clone the existing detail table logic
    let detailHtml = `<table class="table"><thead>
        <tr>
            <th>Sales Team</th>
            <th colspan="2">Total</th>
            <th colspan="2">HE</th>
            <th colspan="2">VET</th>
            <th colspan="2">PY</th>
        </tr>
        <tr>
            <th></th>
            <th>No of CoE</th><th>Gross Sales</th>
            <th>No of CoE</th><th>Gross Sales</th>
            <th>No of CoE</th><th>Gross Sales</th>
            <th>No of CoE</th><th>Gross Sales</th>
        </tr>
    </thead><tbody>`;

    let totals = { t_coe: 0, t_sales: 0, he_coe: 0, he_sales: 0, vet_coe: 0, vet_sales: 0, py_coe: 0, py_sales: 0 };
    Object.keys(tables.detail).forEach(c => {
        const d = tables.detail[c];
        totals.t_coe += d.t_coe; totals.t_sales += d.t_sales;
        totals.he_coe += d.he_coe; totals.he_sales += d.he_sales;
        totals.vet_coe += d.vet_coe; totals.vet_sales += d.vet_sales;
        totals.py_coe += d.py_coe; totals.py_sales += d.py_sales;
        detailHtml += `<tr><td>${c}</td><td>${d.t_coe}</td><td>${fmtMoney(d.t_sales)}</td><td>${d.he_coe}</td><td>${fmtMoney(d.he_sales)}</td><td>${d.vet_coe}</td><td>${fmtMoney(d.vet_sales)}</td><td>${d.py_coe}</td><td>${fmtMoney(d.py_sales)}</td></tr>`;
    });
    detailHtml += `<tr style="font-weight:bold; border-top:2px solid #666;"><td>Total</td><td>${totals.t_coe}</td><td>${fmtMoney(totals.t_sales)}</td><td>${totals.he_coe}</td><td>${fmtMoney(totals.he_sales)}</td><td>${totals.vet_coe}</td><td>${fmtMoney(totals.vet_sales)}</td><td>${totals.py_coe}</td><td>${fmtMoney(totals.py_sales)}</td></tr>`;
    detailHtml += `</tbody></table>`;

    bottomSection.innerHTML += detailHtml;
    container.appendChild(bottomSection);
}

function updateChart(key, canvasId, type, labels, datasets, options = {}) {
    if (charts[key]) charts[key].destroy();
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    charts[key] = new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: { plugins: { legend: { display: type === "doughnut" || datasets.length > 1 } }, ...options }
    });
}

/* ===============================
   HELPERS
   =============================== */
function fmtMoney(n) { return new Intl.NumberFormat().format(Math.round(n || 0)); }
function prettyMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
}
function fyLabelFromDate(date) {
    const y = date.getFullYear(), m = date.getMonth();
    return (m >= 6) ? `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}` : `FY ${y - 1}-${String(y % 100).padStart(2, "0")}`;
}

/* ===============================
   TABS & EXPORT
   =============================== */
document.querySelectorAll("nav [data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("nav [data-tab]").forEach(b => b.classList.remove("tab-active"));
        document.querySelectorAll("section[id^='tab-']").forEach(s => s.classList.add("hidden"));
        btn.classList.add("tab-active");
        document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");

        currentTableId =
            btn.dataset.tab === "fytable" ? "fyTable" :
                btn.dataset.tab === "provider" ? "providerTable" :
                    btn.dataset.tab === "consultant" ? "consultantTable" :
                        btn.dataset.tab === "fycompare" ? "fyCompareTable" :
                            "fyTable";
    });
});

els.exportBtn.addEventListener("click", () => {
    const table = document.getElementById(currentTableId);
    if (!table) return;
    const rows = [...table.querySelectorAll("tr")].map(tr =>
        [...tr.children].map(td => `"${td.innerText.replace(/"/g, '""')}"`).join(",")
    );
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "table.csv";
    a.click();
    URL.revokeObjectURL(url);
});
