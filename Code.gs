const SHEET_STUDENTS = 'Students';
const SHEET_BEHAVIORS = 'Behaviors';
const SHEET_BEHAVIOR_LOG = 'BehaviorLog';
const SHEET_INTERVENTION_LOG = 'InterventionLog';

const BEHAVIOR_HEADERS = ['Timestamp','Period','Student','Behavior','Redirect Button'];
const INTERVENTION_HEADERS = ['Timestamp','Period','Student','Behavior','Intervention Button','Notes'];

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page).toLowerCase() : 'index';
  const fileName = (page === 'dashboard') ? 'Dashboard' : 'index';
  const title = (page === 'dashboard') ? 'RTI Dashboard' : 'RTI Interventions Logger';
  return HtmlService.createTemplateFromFile(fileName)
    .evaluate()
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ---------- Public API ---------- */

function getSetupData() {
  const studentsByPeriod = readStudents_();
  const periods = Object.keys(studentsByPeriod || {}).sort((a,b) => {
    const na = Number(a), nb = Number(b);
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : String(a).localeCompare(String(b));
  });
  const { list: behaviors } = readBehaviors_(true);
  return { periods, studentsByPeriod, behaviors };
}

function getDashboardData(args) {
  const range = (args && args.range) ? String(args.range) : 'all';
  const now = new Date();
  const start = computeRangeStart_(range, now);

  const studentsByPeriod = readStudents_();
  const periods = Object.keys(studentsByPeriod || {}).sort((a,b) => {
    const na = Number(a), nb = Number(b);
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : String(a).localeCompare(String(b));
  });

  const behaviorLogsAll = readBehaviorLog_();
  const interventionLogsAll = readInterventionLog_();

  const inRange = r => !start || !r.timestamp || r.timestamp >= start;

  const behaviorLogs = (behaviorLogsAll || []).filter(inRange);
  const interventionLogs = (interventionLogsAll || []).filter(inRange);

  const { list: behaviors } = readBehaviors_(true);

  return { periods, behaviors, behaviorLogs, interventionLogs };
}

function appendBehaviorLogs(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('No entries to save.');
  const sh = ensureBehaviorLogSheet_();
  const { map: buttonToLogText } = readBehaviors_(false);
  const now = new Date();
  const rows = entries.map(e => {
    const period = sanitizeText_(e.period);
    const student = sanitizeText_(e.student || '');
    const behaviorB = sanitizeText_(e.behavior);
    const redirect = sanitizeText_(e.redirect);
    if (!period) throw new Error('Missing Period.');
    if (!behaviorB) throw new Error('Missing Behavior (button).');
    if (!redirect) throw new Error('Missing Redirect Button.');
    const behaviorLogText = buttonToLogText[behaviorB] || behaviorB;
    return [now, period, student, behaviorLogText, redirect];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, BEHAVIOR_HEADERS.length).setValues(rows);
  return { saved: rows.length };
}

/* ---------- Readers / Helpers ---------- */

function readStudents_() {
  const out = {};
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_STUDENTS);
  if (!sh) return out;
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return out;
  const header = (values[0] || []).map(v => String(v).trim());
  const pIdx = header.indexOf('Period');
  const sIdx = header.indexOf('Student');
  if (pIdx === -1 || sIdx === -1) return out;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const period = String(row[pIdx] || '').trim();
    const student = String(row[sIdx] || '').trim();
    if (!period || !student) continue;
    if (!out[period]) out[period] = [];
    out[period].push(student);
  }
  Object.keys(out).forEach(k => out[k].sort());
  return out;
}

function readBehaviors_(activeOnly) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_BEHAVIORS);
  if (!sh) return { rows: [], list: [], map: {} };

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { rows: [], list: [], map: {} };

  const headers = values.shift().map(v => String(v).trim());
  const idxBtn    = headers.indexOf('Behavior Button');
  const idxText   = headers.indexOf('Log Text');
  const idxActive = headers.indexOf('Active');
  const idxOrder  = headers.indexOf('Order');

  const normBool = v => (v === true || v === 1) ? true : String(v ?? '').trim().toLowerCase().match(/^(true|y|yes|1)$/) !== null;
  const toNum    = v => Number.isFinite(Number(v)) ? Number(v) : Number.POSITIVE_INFINITY;

  const rows = values.map(r => {
    const button = String(r[idxBtn]  ?? '').trim();
    const text   = String(r[idxText] ?? '').trim() || button;
    const active = idxActive >= 0 ? normBool(r[idxActive]) : true;
    const order  = idxOrder  >= 0 ? toNum(r[idxOrder])     : Number.POSITIVE_INFINITY;
    return { button, text, active, order };
  }).filter(x => x.text);

  const filtered = activeOnly ? rows.filter(r => r.active) : rows.slice();
  filtered.sort((a,b) => (a.order - b.order) || a.text.localeCompare(b.text));

  const list = filtered.map(r => r.text);
  const map  = Object.fromEntries(filtered.map(r => [r.button, r.text]));

  return { rows: filtered, list, map };
}

function ensureBehaviorLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_BEHAVIOR_LOG);
  if (!sh) sh = ss.insertSheet(SHEET_BEHAVIOR_LOG);
  const firstRow = sh.getRange(1, 1, 1, BEHAVIOR_HEADERS.length).getValues()[0] || [];
  const needsHeader = BEHAVIOR_HEADERS.some((h, i) => ((firstRow[i] || '') !== h));
  if (needsHeader) { sh.getRange(1, 1, 1, BEHAVIOR_HEADERS.length).setValues([BEHAVIOR_HEADERS]); sh.setFrozenRows(1); }
  return sh;
}

function ensureInterventionLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_INTERVENTION_LOG);
  if (!sh) sh = ss.insertSheet(SHEET_INTERVENTION_LOG);
  const firstRow = sh.getRange(1, 1, 1, INTERVENTION_HEADERS.length).getValues()[0] || [];
  const needsHeader = INTERVENTION_HEADERS.some((h, i) => ((firstRow[i] || '') !== h));
  if (needsHeader) { sh.getRange(1, 1, 1, INTERVENTION_HEADERS.length).setValues([INTERVENTION_HEADERS]); sh.setFrozenRows(1); }
  return sh;
}

function readBehaviorLog_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_BEHAVIOR_LOG);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  const header = values[0].map(v => String(v).trim());
  const map = indexMap_(header, BEHAVIOR_HEADERS);
  if (!map.ok) return [];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.every(x => x === '' || x === null)) continue;
    const ts = row[map.idx('Timestamp')];
    out.push({
      timestamp: (ts && ts instanceof Date) ? ts : tryParseDate_(ts),
      period: sanitizeText_(row[map.idx('Period')]),
      student: sanitizeText_(row[map.idx('Student')]),
      behavior: sanitizeText_(row[map.idx('Behavior')]),
      redirect: sanitizeText_(row[map.idx('Redirect Button')])
    });
  }
  return out;
}

function readInterventionLog_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_INTERVENTION_LOG);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  const header = values[0].map(v => String(v).trim());
  const map = indexMap_(header, INTERVENTION_HEADERS);
  if (!map.ok) return [];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.every(x => x === '' || x === null)) continue;
    const ts = row[map.idx('Timestamp')];
    out.push({
      timestamp: (ts && ts instanceof Date) ? ts : tryParseDate_(ts),
      period: sanitizeText_(row[map.idx('Period')]),
      student: sanitizeText_(row[map.idx('Student')]),
      behavior: sanitizeText_(row[map.idx('Behavior')]),
      intervention: sanitizeText_(row[map.idx('Intervention Button')]),
      notes: sanitizeText_(row[map.idx('Notes')])
    });
  }
  return out;
}

function computeRangeStart_(range, now) {
  const d = new Date((now || new Date()).getTime());
  switch ((range || 'today').toLowerCase()) {
    case 'today': d.setHours(0,0,0,0); return d;
    case '7d': d.setDate(d.getDate() - 7); return d;
    case '30d': d.setDate(d.getDate() - 30); return d;
    case 'all': default: return null;
  }
}

function indexMap_(headerRow, expectedHeaders) {
  const trimmed = headerRow.map(h => String(h).trim());
  const idx = name => trimmed.indexOf(name);
  const ok = expectedHeaders.every(h => trimmed.indexOf(h) !== -1);
  return { ok, idx };
}

function sanitizeText_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function tryParseDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const t = Date.parse(v);
  return isNaN(t) ? null : new Date(t);
}

/* ---------- Local debug helpers ---------- */

function __debugDashboard() {
  const out = getDashboardData({ range: 'all' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function __debugSetup() {
  const out = getSetupData();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
