//Code.gs Lama
/**
 * ============================================================
 *  TTE AUTOMATION — Google Apps Script
 *  Struktur Form (14 kolom):
 *  A  Timestamp
 *  B  Email
 *  C  Persetujuan
 *  D  Nama Dokumen
 *  E  Pemaraf         (checkbox, pisah koma: "kabid, kabag")
 *  F  Penandatangan 1 (dropdown)
 *  G  Anchor 1        (checkbox, pisah koma: "*, #")
 *  H  Penandatangan 2 (dropdown, opsional)
 *  I  Anchor 2        (checkbox, opsional)
 *  J  Penandatangan 3 (dropdown, opsional)
 *  K  Anchor 3        (checkbox, opsional)
 *  L  Penandatangan 4 (dropdown, opsional)
 *  M  Anchor 4        (checkbox, opsional)
 *  N  Link File       (upload via Google Form)
 *
 *  Struktur QUEUE_NEW (14 kolom):
 *  A  ID
 *  B  Nama Dokumen
 *  C  Pemaraf
 *  D  Penandatangan 1 | E  Anchor 1
 *  F  Penandatangan 2 | G  Anchor 2
 *  H  Penandatangan 3 | I  Anchor 3
 *  J  Penandatangan 4 | K  Anchor 4
 *  L  Tahun
 *  M  Link File Lokal
 *  N  Status
 * ============================================================
 */

// ============================================================
//  KONSTANTA
// ============================================================
const SHEET_FORM     = 'Form_Responses';
const SHEET_QUEUE    = 'QUEUE_NEW';
const CSV_FILENAME   = 'tte_upload.csv';
const BASE_PATH      = 'G:\\My Drive\\TTE_CSV\\datasources\\Pengajuan TTE (File responses)\\Upload Dokumen (File responses)';
const FOLDER_TTE     = 'TTE_CSV';
const FOLDER_DATA    = 'datasources';

// ============================================================
//  HELPER: Ambil atau buat subfolder
// ============================================================
function getTargetFolder() {
  const mainFolders = DriveApp.getFoldersByName(FOLDER_TTE);
  if (!mainFolders.hasNext()) throw new Error(`Folder '${FOLDER_TTE}' tidak ditemukan di Drive`);

  const mainFolder = mainFolders.next();
  const subFolders = mainFolder.getFoldersByName(FOLDER_DATA);
  return subFolders.hasNext() ? subFolders.next() : mainFolder.createFolder(FOLDER_DATA);
}

// ============================================================
//  HELPER: Generate timestamp string dari Date object
// ============================================================
function formatTimestamp(date) {
  const y  = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  const h  = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s  = String(date.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}_${h}${mi}${s}`;
}

// ============================================================
//  TRIGGER: Dipanggil otomatis saat Form disubmit
// ============================================================
function onFormSubmit(e) {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const formSheet = ss.getSheetByName(SHEET_FORM);
  const queueNew  = ss.getSheetByName(SHEET_QUEUE);

  if (!formSheet || !queueNew) {
    console.error('❌ Sheet tidak ditemukan. Cek nama sheet.');
    return;
  }

  const row  = e.range.getRow();
  const data = formSheet.getRange(row, 1, 1, 14).getValues()[0];

  const [
    timestamp,      // A
    email,          // B
    persetujuan,    // C
    namaDokumen,    // D
    pemaraf,        // E — "kabid, kabag"
    penandatangan1, // F
    anchor1,        // G — "*, #"
    penandatangan2, // H (opsional)
    anchor2,        // I (opsional)
    penandatangan3, // J (opsional)
    anchor3,        // K (opsional)
    penandatangan4, // L (opsional)
    anchor4,        // M (opsional)
    linkFile,       // N — URL Google Drive
    chatId          // O — Chat ID
  ] = data;

  // Validasi wajib
  if (!namaDokumen || !penandatangan1 || !anchor1 || !linkFile) {
    console.warn(`⚠️ Baris ${row} dilewati: data wajib tidak lengkap`);
    return;
  }

  // Filter tahun
  const date  = new Date(timestamp);
  const tahun = date.getFullYear();
  if (tahun <= 2025) {
    console.warn(`⚠️ Baris ${row} dilewati: tahun ${tahun} <= 2025`);
    return;
  }

  // Generate link file lokal
  const tsStr        = formatTimestamp(date);
  const fileName     = `${tsStr}_${namaDokumen}.pdf`;
  const linkFileLocal = `${BASE_PATH}\\${fileName}`;

  // Tulis linkFileLocal ke kolom O (kolom 15) di Form_Responses
  formSheet.getRange(row, 15).setValue(linkFileLocal);

  // Generate ID unik
  const id  = Utilities.getUuid();
  const now = new Date();

  // Append ke QUEUE_NEW (17 Kolom: A - Q)
  queueNew.appendRow([
    id,             // A
    namaDokumen,    // B
    pemaraf,        // C
    penandatangan1, // D
    anchor1,        // E
    penandatangan2, // F (bisa kosong)
    anchor2,        // G (bisa kosong)
    penandatangan3, // H (bisa kosong)
    anchor3,        // I (bisa kosong)
    penandatangan4, // J (bisa kosong)
    anchor4,        // K (bisa kosong)
    date,           // L — Tanggal Pengajuan (datetime full)
    linkFileLocal,  // M
    'READY',        // N — Status (READY)
    chatId,         // O — Chat ID
    email,          // P — NIP / Pengusul (Email karena lewat form)
    linkFile        // Q — URL Google Drive (dari Form)
  ]);

  // Rename file di Google Drive sesuai konvensi nama
  try {
    if (linkFile && linkFile.includes('id=')) {
      const fileId = linkFile.split('id=')[1].split('&')[0];
      const file   = DriveApp.getFileById(fileId);
      if (file.getName() !== fileName) {
        file.setName(fileName);
        console.log(`✅ File renamed: ${fileName}`);
      }
    }
  } catch (err) {
    console.warn(`⚠️ Gagal rename file: ${err.message}`);
  }

  console.log(`✅ Dokumen '${namaDokumen}' berhasil ditambahkan ke QUEUE_NEW`);
}

// ============================================================
//  SYNC: Spreadsheet → CSV (dipanggil manual atau terjadwal)
//  Gunakan ini agar RPA bisa baca data terbaru
// ============================================================
function syncSpreadsheetToCSV() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_FORM);
  if (!sheet) { console.error('❌ Sheet tidak ditemukan'); return; }

  const data = sheet.getDataRange().getValues();
  const csv  = data
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const targetFolder = getTargetFolder();
  const files        = targetFolder.getFilesByName(CSV_FILENAME);

  if (files.hasNext()) {
    files.next().setContent(csv);
  } else {
    targetFolder.createFile(CSV_FILENAME, csv, MimeType.CSV);
  }

  console.log(`✅ CSV berhasil disinkronkan: ${new Date()}`);
  SpreadsheetApp.getActiveSpreadsheet().toast('CSV berhasil disinkronkan', 'Selesai');
}

// ============================================================
//  IMPORT: CSV → Spreadsheet (untuk sinkronisasi status dari RPA)
//  Panggil ini setelah RPA selesai agar status di Sheet terupdate
// ============================================================
function importCSVToSpreadsheet() {
  const targetFolder = getTargetFolder();
  const files        = targetFolder.getFilesByName(CSV_FILENAME);

  if (!files.hasNext()) {
    console.warn(`⚠️ File '${CSV_FILENAME}' tidak ditemukan`);
    return;
  }

  const csvContent = files.next().getBlob().getDataAsString();
  const delimiter  = csvContent.includes(';') ? ';' : ',';
  const csvData    = Utilities.parseCsv(csvContent, delimiter);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_FORM);

  if (sheet) {
    sheet.clearContents();
    sheet.getRange(1, 1, csvData.length, csvData[0].length).setValues(csvData);
    ss.toast('Status berhasil disinkronkan dari RPA', 'Selesai');
    console.log(`✅ Import CSV selesai: ${csvData.length - 1} baris`);
  }
}

// ============================================================
//  EXPORT: Rename semua file + rebuild CSV dari awal
//  Gunakan ini jika ingin reset / rebuild ulang CSV
// ============================================================
function exportToCSV() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_FORM);
  if (!sheet) { console.error('❌ Sheet tidak ditemukan'); return; }

  const data = sheet.getDataRange().getValues();

  // Rename semua file PDF di Drive sesuai konvensi nama
  for (let i = 1; i < data.length; i++) {
    const timestamp    = data[i][0];
    const namaDokumen  = data[i][3];
    const fileUrl      = data[i][13]; // Kolom N = Link File

    if (!fileUrl || !fileUrl.includes('id=')) continue;

    try {
      const tsStr   = formatTimestamp(new Date(timestamp));
      const newName = `${tsStr}_${namaDokumen}.pdf`;
      const fileId  = fileUrl.split('id=')[1].split('&')[0];
      const file    = DriveApp.getFileById(fileId);

      if (file.getName() !== newName) {
        file.setName(newName);
        console.log(`✅ Renamed: ${newName}`);
      }
    } catch (err) {
      console.warn(`⚠️ Gagal rename baris ${i + 1}: ${err.message}`);
    }
  }

  // Tulis CSV baru
  const csv          = data
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const targetFolder = getTargetFolder();
  const files        = targetFolder.getFilesByName(CSV_FILENAME);

  if (files.hasNext()) {
    files.next().setContent(csv);
  } else {
    targetFolder.createFile(CSV_FILENAME, csv, MimeType.CSV);
  }

  console.log(`✅ Export CSV selesai`);
  SpreadsheetApp.getActiveSpreadsheet().toast('Export CSV selesai', 'Selesai');
}