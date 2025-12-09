/* worker.js */

const CLOUDFLARE_URL = "https://mis-onshore.ashishoct34.workers.dev/";
const AR_URL = "https://ar.ashishoct34.workers.dev/";
const DB_NAME = "SalesDashboardDB";
const STORE_NAME = "dataStore";
const CACHE_KEY = "dashboardData";
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 hour

let raw = [];
let arData = { admission: null, migration: null };

/* ===============================
   INDEXED DB HELPERS
   =============================== */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCache() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

async function setCache(data) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ ...data, timestamp: Date.now() }, CACHE_KEY);
  } catch (e) { console.error("Cache save failed", e); }
}

/* ===============================
   HELPERS
   =============================== */
function fetchFresh(url) {
  return fetch(url + "?t=" + Date.now());
}

// Optimized Date Parser
const dateCache = new Map();
function parseLooseDate(s) {
  if (!s) return null;
  if (dateCache.has(s)) return dateCache.get(s);

  let d = null;
  // Try ISO/Simple format first (fast path)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(s);
  } else {
    const parsed = new Date(s);
    if (!isNaN(parsed)) {
      d = parsed;
    } else {
      const m = String(s).match(/^(\d{1,2})[-\/](\w+)[-\/](\d{2,4})$/i);
      if (m) {
        d = new Date(
          m[3].length === 2 ? "20" + m[3] : m[3],
          new Date(Date.parse(m[2] + " 1, 2000")).getMonth(),
          m[1]
        );
      }
    }
  }

  if (d && !isNaN(d)) {
    dateCache.set(s, d);
    return d;
  }
  return null;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function prettyMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
}

function fyLabelFromDate(date) {
  const y = date.getFullYear(), m = date.getMonth();
  return (m >= 6) ? `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`
    : `FY ${y - 1}-${String(y % 100).padStart(2, "0")}`;
}

function prevFY(label) {
  const m = label.match(/FY\s+(\d{4})-(\d{2})/);
  if (!m) return "";
  const y = +m[1];
  return `FY ${y - 1}-${String(y).slice(2)}`;
}

function monthsInFY(label) {
  const m = label.match(/FY\s+(\d{4})-(\d{2})/);
  if (!m) return [];
  const start = +m[1];
  const arr = [];
  for (let i = 0; i < 12; i++) {
    arr.push(monthKey(new Date(start, 6 + i, 1)));
  }
  return arr;
}

function fyDateRange(label) {
  const m = label?.match(/FY\s+(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = +m[1];
  return { start: new Date(y, 6, 1), end: new Date(y + 1, 6, 0) };
}

function groupBy(arr, fn) {
  const out = {};
  arr.forEach(x => {
    const k = fn(x);
    (out[k] || (out[k] = [])).push(x);
  });
  return out;
}

function sum(arr, key) {
  return arr.reduce((a, b) => a + (+b[key] || 0), 0);
}

function inRangeYM(ym, from, to, all) {
  const ai = all.indexOf(from), bi = all.indexOf(to), i = all.indexOf(ym);
  if (ai < 0 || bi < 0 || i < 0) return false;
  const lo = Math.min(ai, bi), hi = Math.max(ai, bi);
  return i >= lo && i <= hi;
}

function qIndex(ym) {
  const m = +ym.split("-")[1];
  return [3, 3, 3, 4, 4, 4, 1, 1, 1, 2, 2, 2][m - 1];
}

function fyStartYearFromYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m >= 7 ? y : y - 1;
}

function qLabelFromYM(ym) {
  const q = qIndex(ym);
  const fy = fyStartYearFromYM(ym);
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")} Q${q}`;
}

/* ===============================
   MESSAGE HANDLING
   =============================== */
self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === "INIT") {
    await initData();
  } else if (type === "FILTER") {
    processData(payload);
  }
};

async function initData() {
  // 1. Try Cache First
  const cached = await getCache();
  if (cached && (Date.now() - cached.timestamp < CACHE_EXPIRY)) {
    // Hydrate from cache
    raw = cached.raw.map(r => ({ ...r, date: new Date(r.date) })); // Restore Date objects
    arData = cached.arData;

    postLoadedMessage(true); // true = from cache

    // Background refresh (optional, but good for freshness)
    fetchAndProcess(false);
  } else {
    // No cache or expired, fetch immediately
    await fetchAndProcess(true);
  }
}

async function fetchAndProcess(shouldPost) {
  try {
    const [salesResp, arResp] = await Promise.all([
      fetchFresh(CLOUDFLARE_URL),
      fetchFresh(AR_URL)
    ]);

    const json = await salesResp.json();
    const arJson = await arResp.json();

    arData.admission = arJson.admission_receivable;
    arData.migration = arJson.migration_receivable;

    raw = json.rows.map(r => {
      const date = parseLooseDate(r[6]);
      const sales = parseFloat(String(r[7]).replace(/[$,]/g, "")) || 0;

      return {
        date,
        ym: date ? monthKey(date) : null,
        sales,
        consultant: r[8] || "All",
        provider: r[5] || "All"
      };
    }).filter(r => r.date);

    // Save to Cache
    setCache({ raw, arData });

    if (shouldPost) {
      postLoadedMessage(false);
    }

  } catch (err) {
    if (shouldPost) self.postMessage({ type: "ERROR", payload: err.message });
  }
}

function postLoadedMessage(isCache) {
  // Build domains (Filters)
  const months = new Set(), fys = new Set();
  const cons = new Set(["All"]), prov = new Set(["All"]);

  raw.forEach(r => {
    months.add(r.ym);
    fys.add(fyLabelFromDate(r.date));
    cons.add(r.consultant);
    prov.add(r.provider);
  });

  const allMonths = Array.from(months).sort();
  const allFYs = Array.from(fys).sort();
  const allCons = Array.from(cons).sort();
  const allProv = Array.from(prov).sort();

  self.postMessage({
    type: "DATA_LOADED",
    payload: {
      count: raw.length,
      filters: { allMonths, allFYs, allCons, allProv },
      source: isCache ? "CACHE" : "NETWORK"
    }
  });
}

function processData(filters) {
  const { agg, fy, range, from, to, cons, prov, allMonths } = filters;

  const fyR = fyDateRange(fy);
  const fyMonths = monthsInFY(fy);

  const passes = r =>
    (cons === "All" || r.consultant === cons) &&
    (prov === "All" || r.provider === prov);

  let activeMonths = [];
  if (range) {
    activeMonths = allMonths.filter(m => inRangeYM(m, from, to, allMonths));
  } else {
    activeMonths = fyMonths.slice();
  }

  let rowsActive = [];
  if (range) {
    rowsActive = raw.filter(r => passes(r) && inRangeYM(r.ym, from, to, allMonths));
  } else {
    rowsActive = raw.filter(r => passes(r) && r.date >= fyR.start && r.date <= fyR.end);
  }

  // --- KPIs ---
  const kpiSelPeriod = sum(rowsActive, "sales");
  const kpiTotalAll = sum(raw.filter(passes), "sales");

  const lastFY = prevFY(fy);
  const lastR = fyDateRange(lastFY);
  let lastFYTotal = 0;
  if (lastR) {
    lastFYTotal = sum(
      raw.filter(r => passes(r) && r.date >= lastR.start && r.date <= lastR.end),
      "sales"
    );
  }

  // YTD
  const fyRows = raw.filter(r => passes(r) && r.date >= fyR.start && r.date <= fyR.end);
  const byMonth = groupBy(fyRows, r => r.ym);

  let lastComplete = null;
  fyMonths.forEach(m => {
    if (sum(byMonth[m] || [], "sales") > 0) lastComplete = m;
  });

  const k = lastComplete ? fyMonths.indexOf(lastComplete) + 1 : 0;
  const ytdThis = fyMonths.slice(0, k).reduce((a, m) => a + (sum(byMonth[m] || [], "sales") || 0), 0);

  let ytdLast = 0;
  if (lastR) {
    const lastFYrows = raw.filter(r => passes(r) && r.date >= lastR.start && r.date <= lastR.end);
    const lastByMonth = groupBy(lastFYrows, r => r.ym);
    ytdLast = monthsInFY(lastFY).slice(0, k).reduce((a, m) => a + (sum(lastByMonth[m] || [], "sales") || 0), 0);
  }

  const ytdDelta = ytdLast > 0 ? ((ytdThis - ytdLast) / ytdLast) * 100 : null;

  // Projection
  const nonzero = fyMonths.slice(0, k).map(m => sum(byMonth[m] || [], "sales")).filter(v => v > 0);
  const avg = (nonzero.length ? nonzero : fyMonths.slice(0, k).map(m => sum(byMonth[m] || [], "sales")))
    .reduce((a, b) => a + b, 0) / ((nonzero.length ? nonzero.length : k) || 1);
  const proj = ytdThis + (12 - k) * avg;

  // PoP
  let currentVal = 0, prevVal = 0;
  let chartMonthly = {};
  let tableFY = [];

  if (agg === "monthly") {
    const grp = groupBy(rowsActive, r => r.ym);
    const labels = activeMonths.map(prettyMonth);
    const data = activeMonths.map(m => sum(grp[m] || [], "sales"));
    chartMonthly = { labels, data };

    activeMonths.forEach(m => {
      const arr = grp[m] || [];
      const s = sum(arr, "sales");
      const coe = arr.length;
      tableFY.push({ label: prettyMonth(m), sales: s, coe, avg: coe ? s / coe : 0, count: arr.length });
    });

    const last = activeMonths[activeMonths.length - 1];
    const prev = activeMonths[activeMonths.length - 2];
    currentVal = sum(grp[last] || [], "sales");
    prevVal = sum(grp[prev] || [], "sales");

  } else {
    const grp = groupBy(rowsActive, r => qLabelFromYM(r.ym));
    const quarters = Array.from(new Set(activeMonths.map(qLabelFromYM)));
    const labels = quarters;
    const data = quarters.map(q => sum(grp[q] || [], "sales"));
    chartMonthly = { labels, data };

    quarters.forEach(q => {
      const arr = grp[q] || [];
      const s = sum(arr, "sales"), coe = arr.length;
      tableFY.push({ label: q, sales: s, coe, avg: coe ? s / coe : 0, count: arr.length });
    });

    const last = quarters[quarters.length - 1];
    const prev = quarters[quarters.length - 2];
    currentVal = sum(grp[last] || [], "sales");
    prevVal = sum(grp[prev] || [], "sales");
  }

  const pop = prevVal > 0 ? ((currentVal - prevVal) / prevVal) * 100 : null;

  // --- Provider ---
  const sumMapProv = {}, cntMapProv = {};
  rowsActive.forEach(r => {
    sumMapProv[r.provider] = (sumMapProv[r.provider] || 0) + r.sales;
    cntMapProv[r.provider] = (cntMapProv[r.provider] || 0) + 1;
  });
  const provLabels = Object.keys(sumMapProv).sort();
  const provData = provLabels.map(k => sumMapProv[k]);
  const provTotal = provData.reduce((a, b) => a + b, 0) || 1;
  const tableProvider = provLabels.map(l => ({
    label: l, sales: sumMapProv[l], coe: cntMapProv[l], share: (sumMapProv[l] / provTotal) * 100
  }));

  // --- Consultant ---
  const sumMapCons = {}, cntMapCons = {};
  rowsActive.forEach(r => {
    sumMapCons[r.consultant] = (sumMapCons[r.consultant] || 0) + r.sales;
    cntMapCons[r.consultant] = (cntMapCons[r.consultant] || 0) + 1;
  });
  const consLabels = Object.keys(sumMapCons).sort((a, b) => (sumMapCons[b] - sumMapCons[a]) || a.localeCompare(b));
  const consData = consLabels.map(k => sumMapCons[k]);
  const consTotal = consData.reduce((a, b) => a + b, 0) || 1;
  const tableConsultant = consLabels.map(l => ({
    label: l, sales: sumMapCons[l], coe: cntMapCons[l], share: (sumMapCons[l] / consTotal) * 100
  }));

  // Underperformers
  const consAvg = consTotal / consLabels.length;
  const underperformers = consLabels.filter(l => sumMapCons[l] < 0.5 * consAvg).map(name => ({
    name, sales: sumMapCons[name], pct: (sumMapCons[name] / (consAvg || 1)) * 100
  }));

  // Consultant Detail
  const detail = {};
  rowsActive.forEach(r => {
    const c = r.consultant;
    let p = r.provider;
    let cat = "OTHER";
    if (p.toUpperCase().includes("HE")) cat = "HE";
    else if (p.toUpperCase().includes("VET")) cat = "VET";
    else if (p.toUpperCase().includes("PY")) cat = "PY";

    if (!detail[c]) detail[c] = { t_coe: 0, t_sales: 0, he_coe: 0, he_sales: 0, vet_coe: 0, vet_sales: 0, py_coe: 0, py_sales: 0, other_coe: 0, other_sales: 0 };
    detail[c].t_coe++;
    detail[c].t_sales += r.sales;
    if (cat === "HE") { detail[c].he_coe++; detail[c].he_sales += r.sales; }
    else if (cat === "VET") { detail[c].vet_coe++; detail[c].vet_sales += r.sales; }
    else if (cat === "PY") { detail[c].py_coe++; detail[c].py_sales += r.sales; }
    else { detail[c].other_coe++; detail[c].other_sales += r.sales; }
  });

  // Projection Chart
  const projLabels = fyMonths.map(prettyMonth);
  const projActual = fyMonths.map(m => sum(byMonth[m] || [], "sales"));
  const projProjected = fyMonths.map(m => k > fyMonths.indexOf(m) ? 0 : avg); // Simplified logic

  // FY Compare
  const fyTotals = {};
  raw.forEach(r => {
    const f = fyLabelFromDate(r.date);
    fyTotals[f] = (fyTotals[f] || 0) + r.sales;
  });
  const fyLabels = Object.keys(fyTotals).sort();
  const fyData = fyLabels.map(l => fyTotals[l]);
  const tableFYCompare = fyLabels.map(l => ({ label: l, sales: fyTotals[l] }));


  self.postMessage({
    type: "RENDER_DATA",
    payload: {
      kpis: {
        selPeriod: kpiSelPeriod,
        totalAll: kpiTotalAll,
        lastFY: lastFYTotal,
        ytd: { this: ytdThis, last: ytdLast, delta: ytdDelta, k },
        projection: proj,
        pop: { current: currentVal, delta: pop, label: agg === "quarterly" ? "QoQ" : "MoM" }
      },
      charts: {
        monthly: chartMonthly,
        provider: { labels: provLabels, data: provData },
        consultant: { labels: consLabels, data: consData },
        projection: { labels: projLabels, actual: projActual, projected: projProjected },
        fy: { labels: fyLabels, data: fyData }
      },
      tables: {
        fy: tableFY,
        provider: tableProvider,
        consultant: tableConsultant,
        detail,
        underperformers,
        fyCompare: tableFYCompare
      },
      ar: arData
    }
  });
}
