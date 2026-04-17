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
