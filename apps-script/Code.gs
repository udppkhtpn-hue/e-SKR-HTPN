/**
 * PORTAL SKR HTPN e-RUJUKAN — Google Apps Script backend
 * -------------------------------------------------------
 * Receives each department's monthly referral estimates from the GitHub Pages form,
 * logs them in "Respons", and rebuilds "Format KKM" in exactly the layout of the
 * KKM template (Bil. Kes SKR Hospital KKM), with the HTPN column filled.
 *
 * Sheets (created by setupSheets()):
 *   Respons         — raw log, one row per DRG per submission (audit trail)
 *   Format KKM      — the KKM table, HTPN column = sum of all ACTIVE submissions
 *   Pecahan Jabatan — DRG x department breakdown + list of active submissions
 *
 * Script Properties (Project Settings → Script Properties), both optional:
 *   ACCESS_CODE   — if set, the form must send this code
 *   NOTIFY_EMAIL  — if set, an email is sent here on every submission
 *
 * Each specialist submits their own estimate (potential referrals, regardless of cost or GL).
 * Rule: a new submission from the same specialist (same e-mail) marks that specialist's older
 * rows as "DIGANTI" (replaced); only "AKTIF" rows are counted. All specialists' active
 * estimates are summed into the HTPN column.
 */

const CFG = {
  SHEET_RAW: 'Respons',
  SHEET_KKM: 'Format KKM',
  SHEET_DEPT: 'Pecahan Jabatan',
  HOSPITAL_INDEX: 7, // 0-based index in HOSPITALS → HTPN Kajang
  TZ: 'Asia/Kuala_Lumpur'
};

const KKM_TITLE = 'ANGGARAN BILANGAN KES RUJUKAN DARI HOSPITAL KKM MENGIKUT SENARAI CADANGAN PERKHIDMATAN INISIATIF SINERGI KESIHATAN RAKYAT (SKR) ';

const HOSPITALS = [
  'Hospital Kuala Lumpur',
  'Hospital Tunku Azizah, Kuala Lumpur',
  'Hospital Selayang',
  'Hospital Sungai Buloh',
  'Hospital Shah Alam',
  'Hospital Tengku Ampuan Rahimah, Klang',
  'Hospital Sultan Idris Shah, Serdang',
  'Hospital Tengku Permaisuri Norashikin, Kajang.'
];

// Exactly as in the KKM template.
const DRGS = [
  [1, 'Other Respiratory System Operating Room Procedures', ['Perubatan Am', 'Perubatan Respiratori', 'Pembedahan Kardiotorasik', 'Pembedahan Pediatrik']],
  [2, 'Other Digestive System Operating Room Procedures', ['Pembedahan Am', 'Pembedahan Upper Gastrointesinal Tract', 'Pembedahan Pediatrik']],
  [3, 'Cholecystectomy Except By Laparoscope Without Choledochoenterostomy', ['Pembedahan Am', 'Pembedahan Hepatobiliari']],
  [4, 'Appendectomy Without Complicated Main Condition', ['Pembedahan Am']],
  [5, 'Other Hernia Procedures', ['Pembedahan Am']],
  [6, 'Anorectal & Stomal Procedures', ['Pembedahan Am', 'Pembedahan Kolorektal']],
  [7, 'Soft Tissue Procedures', ['Pembedahan Am', 'Ortopedik']],
  [8, 'Skin & Subcutaneous Tissue Procedures', ['Pembedahan Am', 'Ortopedik', 'Pembedahan Plastik']],
  [9, 'Other Operative Obstetrics Procedures', ['Obstetrik & Ginekologi']],
  [10, 'Uterine & Adnexa Procedures', ['Obstetrik & Ginekologi']],
  [11, 'Cervix, Vagina And Vulva Procedures', ['Obstetrik & Ginekologi']],
  [12, 'Advanced Uterine And Adnexa Procedures', ['Obstetrik & Ginekologi']],
  [13, 'Ischaemic Cerebrovascular Disease', ['Perubatan Am', 'Neurologi']],
  [14, 'Nonspecific Cerebrovascular Disorders', ['Perubatan Am', 'Neurologi']],
  [15, 'Seizures', ['Perubatan Am', 'Neurologi', 'Pediatrik']],
  [16, 'Dengue', ['Perubatan Am']],
  [17, 'Viral Illness', ['Perubatan Am']],
  [18, 'Ear, Nose, Mouth & Throat Infections', ['Otorinolaringologi']],
  [19, 'Bronchitis & Asthma', ['Perubatan Am', 'Perubatan Respiratori']],
  [20, 'Pneumonia', ['Perubatan Am', 'Perubatan Respiratori']],
  [21, 'Chronic Obstructive Pulmonary Disease', ['Perubatan Am', 'Perubatan Respiratori']],
  [22, 'Coronary Artery Disease', ['Perubatan Am', 'Kardiologi']],
  [23, 'Heart Failure & Shock', ['Perubatan Am', 'Kardiologi']],
  [24, 'Red Blood Cell Disorders', ['Perubatan Am', 'Hematologi Klinikal', 'Pediatrik Am']],
  [25, 'Esophagitis, Gastroenteritis & Miscellaneous Digestive Disorders', ['Gastroenterologi & Hepatologi', 'Pembedahan Am']],
  [26, 'Other Gastrointestinal System Disorders & Infections', ['Gastroenterologi & Hepatologi', 'Pembedahan Am']],
  [27, 'Gastrointestinal Malignancy', ['Gastroenterologi & Hepatologi', 'Pembedahan Am']],
  [28, 'Kidney & Urinary Tract Infections', ['Urologi', 'Pembedahan Am']],
  [29, 'Female Reproductive System Malignancy', ['Obstetrik & Ginekologi']],
  [30, 'Musculoskeletal Infections', ['Ortopedik', 'Pediatrik Am']],
  [31, 'Respiratory Infections & Inflammations Except Pneumonia', ['Perubatan Am', 'Perubatan Respiratori']]
];

const RAW_HEADERS = ['Tarikh & Masa', 'ID Serahan', 'Jabatan / Unit', 'Nama', 'Jawatan', 'E-mel', 'No. Telefon',
  'Bil.', 'Diagnosis Related Group (DRG)', 'Anggaran Kes Sebulan', 'Catatan', 'Status'];
const COL = { TIME: 0, ID: 1, DEPT: 2, NAME: 3, POST: 4, EMAIL: 5, PHONE: 6, NO: 7, DRG: 8, COUNT: 9, NOTES: 10, STATUS: 11 };

// ============================ Web endpoints ============================

function doGet() {
  return json_({ status: 'SUCCESS', message: 'SKR HTPN e-Rujukan API aktif.' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const code = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
    if (code && String(req.code || '').trim() !== code.trim()) {
      return json_({ status: 'AUTH', message: 'Kod akses tidak sah.' });
    }
    if (req.action === 'SUBMIT') return json_(submit_(req));
    if (req.action === 'SUMMARY') return json_(summary_());
    return json_({ status: 'ERROR', message: 'Tindakan tidak sah.' });
  } catch (err) {
    return json_({ status: 'ERROR', message: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================ Submit ============================

function submit_(req) {
  const p = req.profile || {};
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  // Prevent spreadsheet formula injection from free-text fields.
  const safe = s => /^[=+\-@]/.test(s) ? "'" + s : s;

  const profile = {
    dept: safe(clean(p.dept, 100)),
    name: safe(clean(p.name, 120)),
    post: safe(clean(p.post, 120)),
    email: clean(p.email, 120).toLowerCase(),
    phone: safe(clean(p.phone, 20)),
    notes: safe(String(p.notes == null ? '' : p.notes).trim().slice(0, 1000))
  };
  if (!profile.dept) throw new Error('Jabatan / unit diperlukan.');
  if (profile.name.length < 3) throw new Error('Nama diperlukan.');
  if (profile.post.length < 2) throw new Error('Jawatan diperlukan.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new Error('E-mel tidak sah.');

  const entries = req.entries || {};
  const rowsIn = [];
  DRGS.forEach(d => {
    if (!Object.prototype.hasOwnProperty.call(entries, d[0])) return;
    const n = Number(entries[d[0]]);
    if (!Number.isInteger(n) || n < 0 || n > 99999) throw new Error('Nilai tidak sah bagi DRG ' + d[0] + '.');
    rowsIn.push([d[0], d[1], n]);
  });
  if (!rowsIn.length) throw new Error('Tiada anggaran DRG diterima.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ensureRawSheet_(ss);
    const now = new Date();
    const id = 'SKR-' + Utilities.formatDate(now, CFG.TZ, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100);

    // Supersede this specialist's previous ACTIVE rows (keyed by e-mail).
    let replaced = 0;
    const last = sh.getLastRow();
    if (last > 1) {
      const range = sh.getRange(2, 1, last - 1, RAW_HEADERS.length);
      const data = range.getValues();
      const status = data.map(r => [r[COL.STATUS]]);
      data.forEach((r, i) => {
        if (String(r[COL.EMAIL]).trim().toLowerCase() === profile.email && r[COL.STATUS] === 'AKTIF') {
          status[i][0] = 'DIGANTI';
          replaced++;
        }
      });
      if (replaced) sh.getRange(2, COL.STATUS + 1, last - 1, 1).setValues(status);
    }

    const out = rowsIn.map(([no, drg, n]) => [now, id, profile.dept, profile.name, profile.post, profile.email,
      profile.phone, no, drg, n, profile.notes, 'AKTIF']);
    sh.getRange(sh.getLastRow() + 1, 1, out.length, RAW_HEADERS.length).setValues(out);
    SpreadsheetApp.flush();

    rebuildReports();

    const total = rowsIn.reduce((a, r) => a + r[2], 0);
    notify_(id, profile, rowsIn, total, replaced > 0);
    return { status: 'SUCCESS', id: id, total: total, count: rowsIn.length, replaced: replaced > 0 };
  } finally {
    lock.releaseLock();
  }
}

function notify_(id, p, rows, total, replaced) {
  const to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  try {
    const lines = rows.map(r => '  ' + r[0] + '. ' + r[1] + ': ' + r[2]).join('\n');
    MailApp.sendEmail(to, '[SKR HTPN] Serahan baharu: ' + p.dept + ' (' + total + ' kes/bulan)',
      'ID Serahan: ' + id + (replaced ? ' (menggantikan serahan terdahulu pakar ini)' : '') + '\n' +
      'Jabatan: ' + p.dept + '\nNama: ' + p.name + '\nJawatan: ' + p.post + '\nE-mel: ' + p.email +
      (p.phone ? '\nTelefon: ' + p.phone : '') + '\n\nAnggaran kes sebulan:\n' + lines +
      '\n\nJumlah: ' + total + (p.notes ? '\n\nCatatan: ' + p.notes : '') +
      '\n\nHelaian: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  } catch (err) {
    console.warn('Notify failed: ' + err);
  }
}

// ============================ Summary (for the portal) ============================

function summary_() {
  const agg = aggregate_();
  const subs = Object.keys(agg.subs).map(k => agg.subs[k])
    .sort((a, b) => b.time - a.time)
    .map(s => ({ id: s.id, dept: s.dept, name: s.name, post: s.post, total: s.total,
      time: Utilities.formatDate(s.time, CFG.TZ, 'dd/MM/yyyy HH:mm') }));
  return { status: 'SUCCESS', totals: agg.totals, submissions: subs,
    updated: Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy HH:mm') };
}

/** Reads "Respons" and sums ACTIVE rows: totals per DRG, per department, and per submission. */
function aggregate_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensureRawSheet_(ss);
  const totals = {}, byDept = {}, subs = {}, deptPeople = {};
  DRGS.forEach(d => { totals[d[0]] = 0; });
  const last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, RAW_HEADERS.length).getValues().forEach(r => {
      if (r[COL.STATUS] !== 'AKTIF') return;
      const no = Number(r[COL.NO]), n = Number(r[COL.COUNT]) || 0, dept = String(r[COL.DEPT]);
      if (!(no in totals)) return;
      totals[no] += n;
      byDept[dept] = byDept[dept] || {};
      (deptPeople[dept] = deptPeople[dept] || {})[String(r[COL.EMAIL]).trim().toLowerCase()] = true;
      byDept[dept][no] = (byDept[dept][no] || 0) + n;
      const id = String(r[COL.ID]);
      if (!subs[id]) subs[id] = { id: id, dept: dept, name: String(r[COL.NAME]), post: String(r[COL.POST]),
        time: r[COL.TIME] instanceof Date ? r[COL.TIME] : new Date(r[COL.TIME]), total: 0 };
      subs[id].total += n;
    });
  }
  return { totals: totals, byDept: byDept, subs: subs, deptPeople: deptPeople };
}

// ============================ Sheet builders ============================

/** Rebuilds "Format KKM" and "Pecahan Jabatan" from the active rows. Also on the menu. */
function rebuildReports() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const agg = aggregate_();
  buildKkmSheet_(ss, agg.totals);
  buildDeptSheet_(ss, agg);
}

/**
 * Exact KKM layout (matches the CSV template):
 *   row 2  : title in B2
 *   row 4-5: BIL. | DIAGNOSIS RELATED GROUP (DRG) | KEPAKARAN TERLIBAT | ANGGARAN BILANGAN KES RUJUKAN (SETIAP BULAN) over 8 hospitals
 *   row 6+ : 31 DRG rows; only the HTPN column (L) is filled
 */
function buildKkmSheet_(ss, totals) {
  const sh = getOrCreate_(ss, CFG.SHEET_KKM, 1);
  const NCOL = 12, NROW = 5 + DRGS.length;
  sh.clear();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();

  const grid = [];
  for (let i = 0; i < NROW; i++) grid.push(new Array(NCOL).fill(''));
  grid[1][1] = KKM_TITLE;
  grid[3][1] = 'BIL.';
  grid[3][2] = 'DIAGNOSIS RELATED GROUP (DRG)';
  grid[3][3] = 'KEPAKARAN TERLIBAT';
  grid[3][4] = 'ANGGARAN BILANGAN KES RUJUKAN (SETIAP BULAN)';
  HOSPITALS.forEach((h, i) => { grid[4][4 + i] = h; });
  DRGS.forEach((d, i) => {
    const r = grid[5 + i];
    r[1] = d[0];
    r[2] = d[1];
    r[3] = d[2].map((s, j) => '(' + String.fromCharCode(97 + j) + ') ' + s).join('\n');
    r[4 + CFG.HOSPITAL_INDEX] = Number(totals[d[0]] || 0);
  });
  sh.getRange(1, 1, NROW, NCOL).setValues(grid);

  // Formatting
  const all = sh.getRange(1, 1, NROW, NCOL);
  all.setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
  sh.getRange('B2:L2').merge().setFontWeight('bold').setFontSize(11).setWrap(true);
  sh.getRange('B4:B5').merge();
  sh.getRange('C4:C5').merge();
  sh.getRange('D4:D5').merge();
  sh.getRange('E4:L4').merge();
  const head = sh.getRange(4, 2, 2, NCOL - 1);
  head.setFontWeight('bold').setHorizontalAlignment('center').setWrap(true).setBackground('#d9d9d9');
  const body = sh.getRange(6, 2, DRGS.length, NCOL - 1);
  body.setWrap(true);
  sh.getRange(6, 2, DRGS.length, 1).setHorizontalAlignment('center');
  sh.getRange(6, 5, DRGS.length, 8).setHorizontalAlignment('center').setNumberFormat('0');
  sh.getRange(4, 2, NROW - 3, NCOL - 1).setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);

  sh.setColumnWidth(1, 20);
  sh.setColumnWidth(2, 45);
  sh.setColumnWidth(3, 320);
  sh.setColumnWidth(4, 230);
  for (let c = 5; c <= NCOL; c++) sh.setColumnWidth(c, 120);
  sh.setRowHeight(2, 36);
  sh.setFrozenRows(5);
}

function buildDeptSheet_(ss, agg) {
  const sh = getOrCreate_(ss, CFG.SHEET_DEPT, 2);
  sh.clear();
  const depts = Object.keys(agg.byDept).sort();
  const now = Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy HH:mm:ss');

  sh.getRange(1, 1, 1, 2).setValues([['PECAHAN ANGGARAN KES RUJUKAN SKR MENGIKUT JABATAN — HTPN KAJANG', '']]).setFontWeight('bold');
  sh.getRange(2, 1).setValue('Dikemaskini: ' + now + '  ·  Jumlah anggaran individu semua pakar · Hanya serahan AKTIF (terkini bagi setiap pakar) dikira.');

  const header = ['Bil.', 'Diagnosis Related Group (DRG)'].concat(depts, ['JUMLAH HTPN']);
  const rows = DRGS.map(d => [d[0], d[1]].concat(depts.map(k => agg.byDept[k][d[0]] === undefined ? '' : agg.byDept[k][d[0]]), [agg.totals[d[0]] || 0]));
  const totalRow = ['', 'JUMLAH'].concat(depts.map(k => Object.keys(agg.byDept[k]).reduce((a, n) => a + agg.byDept[k][n], 0)),
    [DRGS.reduce((a, d) => a + (agg.totals[d[0]] || 0), 0)]);
  const peopleRow = ['', 'BIL. PAKAR (SERAHAN AKTIF)'].concat(depts.map(k => Object.keys(agg.deptPeople[k] || {}).length),
    [Object.keys(agg.subs).length]);
  const table = [header].concat(rows, [totalRow, peopleRow]);
  sh.getRange(4, 1, table.length, header.length).setValues(table);
  sh.getRange(4, 1, 1, header.length).setFontWeight('bold').setBackground('#111114').setFontColor('#ffd400').setWrap(true);
  sh.getRange(4 + table.length - 2, 1, 2, header.length).setFontWeight('bold').setBackground('#fff6c2');
  sh.getRange(4, 1, table.length, header.length).setBorder(true, true, true, true, true, true);
  sh.getRange(5, header.length, DRGS.length, 1).setFontWeight('bold');

  // Active submissions list
  const start = 4 + table.length + 2;
  const subs = Object.keys(agg.subs).map(k => agg.subs[k]).sort((a, b) => b.time - a.time);
  sh.getRange(start, 1).setValue('SERAHAN AKTIF (SETIAP PAKAR)').setFontWeight('bold');
  const list = [['Tarikh & Masa', 'ID Serahan', 'Jabatan / Unit', 'Nama', 'Jawatan', 'Jumlah Kes']]
    .concat(subs.map(s => [Utilities.formatDate(s.time, CFG.TZ, 'dd/MM/yyyy HH:mm'), s.id, s.dept, s.name, s.post, s.total]));
  sh.getRange(start + 1, 1, list.length, 6).setValues(list);
  sh.getRange(start + 1, 1, 1, 6).setFontWeight('bold').setBackground('#d9d9d9');

  sh.setColumnWidth(1, 110);
  sh.setColumnWidth(2, 340);
  for (let c = 3; c <= Math.max(header.length, 6); c++) sh.setColumnWidth(c, 130);
  sh.setFrozenRows(4);
}

// ============================ Setup + helpers ============================

function ensureRawSheet_(ss) {
  const sh = getOrCreate_(ss, CFG.SHEET_RAW, 3);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, RAW_HEADERS.length).setValues([RAW_HEADERS])
      .setFontWeight('bold').setBackground('#111114').setFontColor('#ffd400');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }
  return sh;
}

function getOrCreate_(ss, name, position) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, Math.min(position - 1, ss.getSheets().length));
  }
  return sh;
}

/** Run once from the editor (or the menu) to create all sheets. */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRawSheet_(ss);
  rebuildReports();
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Helaian1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  ss.setActiveSheet(ss.getSheetByName(CFG.SHEET_KKM));
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Portal SKR')
    .addItem('Sediakan / bina semula helaian', 'setupSheets')
    .addItem('Kemas kini Format KKM', 'rebuildReports')
    .addToUi();
}
