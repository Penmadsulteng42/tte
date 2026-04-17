/**
 * ============================================================
 *  REBUILD QUEUE_NEW dari Form_Responses
 *  Simpan file ini sebagai: rebuild.gs
 *
 *  STRUKTUR Form_Responses (A–O, index 0–14):
 *  0  Timestamp
 *  1  Email address
 *  2  Persetujuan TTE
 *  3  Nama Dokumen
 *  4  Pemaraf
 *  5  Penandatangan 1      6  Kode TTE Penandatangan 1
 *  7  Penandatangan 2      8  Kode TTE Penandatangan 2
 *  9  Penandatangan 3      10 Kode TTE Penandatangan 3
 *  11 Penandatangan 4      12 Kode TTE Penandatangan 4
 *  13 Link Google Drive
 *  14 Link Local
 * ============================================================
 */

function rebuildQueueFromForm() {
  var RB_FORM    = 'Form_Responses';
  var RB_QUEUE   = 'QUEUE_NEW';
  var RB_BACKUP  = 'QUEUE_NEW_BACKUP';
  var RB_PATH    = 'G:\\My Drive\\TTE_CSV\\datasources\\Pengajuan TTE (File responses)\\Upload Dokumen (File responses)';
  var RB_COLS    = 15; // Paksa baca 15 kolom (A–O)

  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var formSheet  = ss.getSheetByName(RB_FORM);
  var queueSheet = ss.getSheetByName(RB_QUEUE);

  if (!formSheet || !queueSheet) {
    SpreadsheetApp.getUi().alert('❌ Sheet Form_Responses atau QUEUE_NEW tidak ditemukan!');
    return;
  }

  // --- Baca Form_Responses — PAKSA 15 kolom agar P2–P4 tidak terpotong ---
  var lastRow  = formSheet.getLastRow();
  if (lastRow <= 1) {
    SpreadsheetApp.getUi().alert('ℹ️ Tidak ada data di Form_Responses.');
    return;
  }

  // Baca header (baris 1) dan data (baris 2 dst) secara eksplisit
  var formData = formSheet.getRange(1, 1, lastRow, RB_COLS).getValues();

  // --- Backup QUEUE_NEW dulu ---
  var queueData   = queueSheet.getDataRange().getValues();
  var backupSheet = ss.getSheetByName(RB_BACKUP);
  if (backupSheet) {
    backupSheet.clearContents();
  } else {
    backupSheet = ss.insertSheet(RB_BACKUP);
  }
  backupSheet.getRange(1, 1, queueData.length, queueData[0].length).setValues(queueData);
  console.log('💾 Backup QUEUE_NEW: ' + (queueData.length - 1) + ' baris');

  // --- Bangun map STATUS dari QUEUE_NEW lama (key: Nama Dokumen) ---
  var statusMap = {};
  for (var q = 1; q < queueData.length; q++) {
    var qNama   = String(queueData[q][1] || '').trim();
    var qStatus = String(queueData[q][13] || '').trim();
    if (qNama) statusMap[qNama] = qStatus;
  }
  console.log('📋 Status dari QUEUE_NEW lama: ' + Object.keys(statusMap).length + ' entri');

  // --- Header QUEUE_NEW format baru ---
  var newHeader = [
    'ID', 'Nama Dokumen', 'Pemaraf',
    'Penandatangan1', 'Anchor1',
    'Penandatangan2', 'Anchor2',
    'Penandatangan3', 'Anchor3',
    'Penandatangan4', 'Anchor4',
    'Tahun', 'Link File Lokal', 'Status'
  ];

  // --- Proses tiap baris Form_Responses ---
  var newRows   = [];
  var skipped   = 0;
  var processed = 0;

  for (var i = 1; i < formData.length; i++) {
    var row = formData[i];

    var timestamp      = row[0];
    var namaDokumen    = String(row[3]  || '').trim();
    var pemaraf        = String(row[4]  || '').trim();
    var penandatangan1 = String(row[5]  || '').trim();
    var anchor1        = String(row[6]  || '').trim();
    var penandatangan2 = String(row[7]  || '').trim();
    var anchor2        = String(row[8]  || '').trim();
    var penandatangan3 = String(row[9]  || '').trim();
    var anchor3        = String(row[10] || '').trim();
    var penandatangan4 = String(row[11] || '').trim();
    var anchor4        = String(row[12] || '').trim();
    var linkDrive      = String(row[13] || '').trim();
    var linkLocal      = String(row[14] || '').trim();

    // Skip baris kosong atau tidak ada penandatangan 1
    if (!namaDokumen || !penandatangan1) {
      skipped++;
      continue;
    }

    // Filter tahun <= 2025
    var date  = new Date(timestamp);
    var tahun = date.getFullYear();
    if (!tahun || tahun <= 2025) {
      skipped++;
      continue;
    }

    // Generate linkLocal jika belum ada di kolom O
    var finalLinkLocal = linkLocal;
    if (!finalLinkLocal && linkDrive) {
      var y    = date.getFullYear();
      var mo   = String(date.getMonth() + 1).padStart(2, '0');
      var d    = String(date.getDate()).padStart(2, '0');
      var h    = String(date.getHours()).padStart(2, '0');
      var mi   = String(date.getMinutes()).padStart(2, '0');
      var s    = String(date.getSeconds()).padStart(2, '0');
      var ts   = y + mo + d + '_' + h + mi + s;
      var fn   = ts + '_' + namaDokumen + '.pdf';
      finalLinkLocal = RB_PATH + '\\' + fn;
      formSheet.getRange(i + 1, 15).setValue(finalLinkLocal);
    }

    // Pertahankan status lama jika ada
    var existingStatus = statusMap[namaDokumen] || '';

    newRows.push([
      Utilities.getUuid(), // A
      namaDokumen,         // B
      pemaraf,             // C
      penandatangan1,      // D
      anchor1,             // E
      penandatangan2,      // F
      anchor2,             // G
      penandatangan3,      // H
      anchor3,             // I
      penandatangan4,      // J
      anchor4,             // K
      tahun,               // L
      finalLinkLocal,      // M
      existingStatus       // N
    ]);

    console.log('[' + i + '] ' + namaDokumen +
      ' P1:' + penandatangan1 + ' A1:' + anchor1 +
      ' P2:' + (penandatangan2 || '-') + ' A2:' + (anchor2 || '-') +
      ' Status:' + (existingStatus || 'baru'));
    processed++;
  }

  // --- Tulis ulang QUEUE_NEW ---
  queueSheet.clearContents();
  var allData = [newHeader].concat(newRows);
  queueSheet.getRange(1, 1, allData.length, 14).setValues(allData);
  queueSheet.getRange(1, 1, 1, 14).setFontWeight('bold');

  // --- Ringkasan ---
  var total    = newRows.length;
  var belum    = newRows.filter(function(r) { return r[13] === ''; }).length;
  var uploaded = newRows.filter(function(r) { return r[13] === 'UPLOADED'; }).length;
  var signed   = newRows.filter(function(r) { return r[13] === 'SIGNED'; }).length;
  var done     = newRows.filter(function(r) { return r[13] === 'DOWNLOADED'; }).length;

  var msg =
    '✅ Rebuild selesai!\n\n' +
    'Diproses      : ' + processed + ' baris\n' +
    'Dilewati      : ' + skipped   + ' baris\n\n' +
    'Belum diproses: ' + belum     + ' baris\n' +
    'UPLOADED      : ' + uploaded  + ' baris\n' +
    'SIGNED        : ' + signed    + ' baris\n' +
    'DOWNLOADED    : ' + done      + ' baris\n\n' +
    '💾 Backup di: QUEUE_NEW_BACKUP';

  console.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}