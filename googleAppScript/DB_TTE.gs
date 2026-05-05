/**
 * DB_TTE.gs
 * Menangani penyimpanan dokumen dan pengambilan data dari QUEUE_NEW
 *
 * STRUKTUR KOLOM QUEUE_NEW (A - Q):
 * A  (0)  : ID (UUID)
 * B  (1)  : Nama Dokumen
 * C  (2)  : Pemaraf (string, dipisah koma)
 * D  (3)  : Penandatangan 1
 * E  (4)  : Anchor 1
 * F  (5)  : Penandatangan 2
 * G  (6)  : Anchor 2
 * H  (7)  : Penandatangan 3
 * I  (8)  : Anchor 3
 * J  (9)  : Penandatangan 4
 * K  (10) : Anchor 4
 * L  (11) : Tanggal Pengajuan (datetime)   ← dulunya hanya Tahun
 * M  (12) : Link File Lokal (untuk RPA)
 * N  (13) : Status
 * O  (14) : Chat ID
 * P  (15) : NIP Pengusul
 * Q  (16) : URL Google Drive               ← kolom BARU
 */

const SS_ID = '1sOWTiTA2RjiWbl8UuRw8D-p_tqEsy8LrHXmrDRquYDY';
const FOLDER_UPLOAD_ID = '1uxMrYLvNgsvOdoGrwZmgZHE2d4glFqSKp09wG02yjjY3CnHIOXQO78NoK02OJ18TZHF23KR5';

// ============================================================
// SIMPAN PENGAJUAN BARU
// ============================================================
function saveSubmission(payload, userNip) {
  try {
    const ss = SpreadsheetApp.openById(SS_ID);
    const sheet = ss.getSheetByName("QUEUE_NEW");

    // 1. Upload File ke Google Drive
    const folder = DriveApp.getFolderById(FOLDER_UPLOAD_ID);
    const blob = Utilities.newBlob(
      Utilities.base64Decode(payload.fileBase64),
      payload.fileType
    );

    // Format Nama File: YYYYMMDD_HHMMSS_NamaDokumen.pdf
    const now = new Date();
    const ts = Utilities.formatDate(now, "GMT+8", "yyyyMMdd_HHmmss");
    const fileName = `${ts}_${payload.namaDokumen}.pdf`;
    blob.setName(fileName);

    const file = folder.createFile(blob);
    const fileUrl = file.getUrl(); // ✅ URL Drive yang akan disimpan

    // 2. Link lokal untuk RPA
    const basePath = "G:\\My Drive\\TTE_CSV\\datasources\\Pengajuan TTE (File responses)\\Upload Dokumen (File responses)";
    const linkFileLocal = `${basePath}\\${fileName}`;

    // 3. Proses string Pemaraf
    let pemarafStr = "";
    if (payload.pemaraf && payload.pemaraf.length > 0) {
      pemarafStr = payload.pemaraf.filter(p => p !== 'null').join(', ');
    }

    // 4. Susun baris baru (17 kolom: A - Q)
    const newRow = [
      Utilities.getUuid(),                  // A : ID
      payload.namaDokumen,                  // B : Nama Dokumen
      pemarafStr,                           // C : Pemaraf
      payload.p1,                           // D : Penandatangan 1
      payload.a1.join(', '),                // E : Anchor 1
      payload.p2 || "",                     // F : Penandatangan 2
      payload.a2 ? payload.a2.join(', ') : "", // G : Anchor 2
      payload.p3 || "",                     // H : Penandatangan 3
      payload.a3 ? payload.a3.join(', ') : "", // I : Anchor 3
      payload.p4 || "",                     // J : Penandatangan 4
      payload.a4 ? payload.a4.join(', ') : "", // K : Anchor 4
      now.getFullYear(),                    // L : Tahun
      linkFileLocal,                        // M : Link Lokal (RPA)
      "READY",                            // N : Status
      "",                                   // O : Chat ID
      userNip,                              // P : NIP Pengusul
      fileUrl,                              // Q : URL Google Drive
      now,                                  // R : Tanggal Pengajuan (baru)
      ""                                    // S : Link TTE Final
    ];

    sheet.appendRow(newRow);

    return {
      status: "success",
      message: "Dokumen berhasil diajukan dengan ID: " + newRow[0]
    };

  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

// ============================================================
// AMBIL DAFTAR PENGAJUAN MILIK USER (untuk tabel di halaman TTE)
// ============================================================
function getTTEList(userNip) {
  try {
    const ss = SpreadsheetApp.openById(SS_ID);
    const sheet = ss.getSheetByName("QUEUE_NEW");
    const values = sheet.getDataRange().getValues();

    // Buang baris header (baris pertama)
    const dataRows = values.slice(1);

    // Filter hanya milik user yang login (Kolom P = index 15)
    const filtered = dataRows.filter(r => {
      return String(r[15]).trim() === String(userNip).trim();
    });

    return filtered.map((r, index) => {

      // --- Format Pemaraf ---
      // Kolom C (r[2]) berisi string "Kabid, Kabag" → pecah per koma
      const pemarafArr = r[2]
        ? String(r[2]).split(',').map(s => s.trim()).filter(s => s)
        : [];

      // --- Format Penandatangan ---
      // Pasangkan setiap Penandatangan (D,F,H,J) dengan Anchor-nya (E,G,I,K)
      const pasanganPenandatangan = [
        { nama: r[3], anchor: r[4] },   // P1 + A1
        { nama: r[5], anchor: r[6] },   // P2 + A2
        { nama: r[7], anchor: r[8] },   // P3 + A3
        { nama: r[9], anchor: r[10] }   // P4 + A4
      ].filter(p => p.nama && String(p.nama).trim() !== "");

      // --- Format Tanggal ---
      // Kolom R (r[17]) sekarang menyimpan full datetime
      let tanggal = "-";
      if (r[17]) {
        try {
          tanggal = Utilities.formatDate(new Date(r[17]), "GMT+8", "dd/MM/yyyy");
        } catch (e) {
          tanggal = String(r[17]);
        }
      }

      return {
        no            : index + 1,
        namaDokumen   : r[1]  || "-",          // Kolom B
        tanggal       : tanggal,               // Kolom R (diformat)
        pemaraf       : pemarafArr,            // Array string
        penandatangan : pasanganPenandatangan, // Array { nama, anchor }
        status        : r[13] || "READY",    // Kolom N
        linkDrive     : r[16] || ""            // Kolom Q (URL Drive) ✅
      };
    });

  } catch (e) {
    throw new Error("Gagal mengambil data: " + e.message);
  }
}

// ============================================================
// REKAP DASHBOARD (filter per NIP)
// ============================================================
function getDashboardData(userNip) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName("QUEUE_NEW");
  const data = sheet.getDataRange().getValues();

  let total = 0, proses = 0, selesai = 0;

  for (let i = 1; i < data.length; i++) {
    const nipDiSheet = data[i][15]; // Kolom P
    if (String(nipDiSheet).trim() === String(userNip).trim()) {
      total++;
      const status = String(data[i][13]).toUpperCase(); // Kolom N
      if (status === "DOWNLOADED" || status === "SIGNED") {
        selesai++;
      } else {
        proses++;
      }
    }
  }

  return { total, proses, selesai };
}