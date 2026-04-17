// Code.gs Baru
const DAFTAR_PEJABAT = ["Kakanwil", "Kabag", "Kabid", "Bendahara"];
const DAFTAR_ANCHOR = ["$", "*", "#", "^"];

function getFormMasterData() {
  return {
    pejabat: DAFTAR_PEJABAT,
    anchor: DAFTAR_ANCHOR
  };
}

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
      .setTitle('Sistem Penmad TTE')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Fungsi untuk menggabungkan file HTML
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Fungsi Login
function processLogin(nip, pass) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("User");
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] == nip && data[i][3] == pass) {
      // Update Last Login
      sheet.getRange(i + 1, 6).setValue(new Date());
      return {
        status: "success",
        user: { nama: data[i][1], nip: data[i][2] }
      };
    }
  }
  return { status: "error", message: "NIP atau Password salah!" };
}

function getTTEList(nip) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("QUEUE_NEW");
    const values = sheet.getDataRange().getValues();
    
    // Gunakan slice(1) untuk membuang header agar tidak ikut terfilter
    const dataRows = values.slice(1);
    
    // Filter berdasarkan NIP di Kolom P (Indeks 15)
    const filtered = dataRows.filter(r => {
      return String(r[15]).trim() === String(nip).trim();
    });
    
    return filtered.map((r, index) => {
      // Menyatukan data Pemaraf (Kolom C, E, G, I)
      const listPemaraf = [r[2], r[4], r[6], r[8]].filter(name => name && name !== "-").join("<br>");
      
      // Menyatukan data Penandatangan (Kolom D, F, H, J)
      const listPenandatangan = [r[3], r[5], r[7], r[9]].filter(name => name && name !== "-").join("<br>");

      return {
        no: index + 1,
        namaDokumen: r[1],      // Kolom B
        pemaraf: listPemaraf || "-",
        penandatangan: listPenandatangan || "-",
        status: r[13],          // Kolom N (Status)
        linkDrive: r[12]        // Kolom M (Link Lokal/Drive)
      };
    });
  } catch (e) {
    throw new Error("Gagal mengambil data: " + e.message);
  }
}

// Fungsi untuk mengambil data dashboard milik staf tertentu
function getDashboardData(userNip) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("QUEUE_NEW");
  const data = sheet.getDataRange().getValues();
  
  let rekap = {
    total: 0,
    proses: 0,
    selesai: 0
  };

  // Asumsi: Kita tambahkan kolom NIP di akhir atau filter via logic lain
  // Untuk sementara, jika belum ada kolom NIP, kita tampilkan semua data 
  // (Nanti kita sesuaikan setelah kolom NIP ditambahkan)
  
  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][13]).toUpperCase(); // Kolom N (index 13)
    
    rekap.total++;
    if (status === "DOWNLOADED" || status === "SENT") {
      rekap.selesai++;
    } else {
      rekap.proses++;
    }
  }
  return rekap;
}