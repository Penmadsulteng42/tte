const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config();

let auth;
console.log('GOOGLE_CREDENTIALS:', process.env.GOOGLE_CREDENTIALS ? 'ADA' : 'TIDAK ADA');
if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
    });
} else {
    auth = new google.auth.GoogleAuth({
        keyFile: 'service-account.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
    });
}

const SPREADSHEET_ID = '1sOWTiTA2RjiWbl8UuRw8D-p_tqEsy8LrHXmrDRquYDY';
const SHEET_NAME = 'QUEUE_NEW';

/*
 * STRUKTUR KOLOM QUEUE_NEW (A–O):
 * A  → ID
 * B  → Nama Dokumen
 * C  → Pemaraf
 * D  → Penandatangan 1      E  → Anchor 1
 * F  → Penandatangan 2      G  → Anchor 2
 * H  → Penandatangan 3      I  → Anchor 3
 * J  → Penandatangan 4      K  → Anchor 4
 * L  → Tahun
 * M  → Link File
 * N  → Status: kosong/READY = antrian upload; UPLOADED/PARAFED/SIGNED sesuai pipeline; SENT/DOWNLOADED = selesai
 * O  → Chat ID Telegram
 */

async function readRows() {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:Q`
        });

        const rows = res.data.values || [];

        return rows.map((row, index) => ({
            row: index + 2,
            id: row[0] || '',
            nama: row[1] || '',
            pemaraf: row[2] || '',
            penandatangan1: row[3] || '',
            anchor1: row[4] || '',
            penandatangan2: row[5] || '',
            anchor2: row[6] || '',
            penandatangan3: row[7] || '',
            anchor3: row[8] || '',
            penandatangan4: row[9] || '',
            anchor4: row[10] || '',
            tahun: row[11] || '',
            linkFileLocal: row[12] || '',
            status: row[13] || '',
            chatId: row[14] || '',
            nip: row[15] || '',
            urlDrive: row[16] || ''
        }));

    } catch (err) {
        console.error('❌ Gagal membaca Spreadsheet:', err.message);
        return [];
    }
}

async function appendRow(item) {
    // ── Validasi field wajib sebelum simpan ke sheets ──
    const errors = [];
    if (!item.namaDokumen || !item.namaDokumen.trim())
        errors.push('namaDokumen kosong');
    if (!item.penandatangan1 || !item.penandatangan1.trim())
        errors.push('penandatangan1 kosong');
    if (!item.linkFileLocal || !item.linkFileLocal.trim())
        errors.push('linkFileLocal kosong');
    if (!item.anchor1 || !item.anchor1.trim())
        errors.push('anchor1 kosong');

    if (errors.length > 0) {
        const msg = `Data tidak lengkap, ditolak: ${errors.join(', ')}`;
        console.error(`❌ ${msg}`);
        throw new Error(msg);
    }

    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // ── Cari baris terakhir yang terisi di kolom A ──
        // Tidak pakai values.append karena API bisa salah deteksi "tabel"
        // ketika banyak kolom di tengah kosong (pen2-4, anchor2-4),
        // akibatnya data baru ditulis mulai kolom L bukan kolom A.
        const colARes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`
        });
        const nextRow = (colARes.data.values || []).length + 1;

        // ── Tulis ke baris berikutnya dengan range eksplisit mulai A ──
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${nextRow}:S${nextRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    uuidv4(),             // A — ID
                    item.namaDokumen,     // B
                    item.pemaraf,         // C
                    item.penandatangan1,  // D
                    item.anchor1,         // E
                    item.penandatangan2,  // F
                    item.anchor2,         // G
                    item.penandatangan3,  // H
                    item.anchor3,         // I
                    item.penandatangan4,  // J
                    item.anchor4,         // K
                    new Date().getFullYear(), // L — Tahun
                    item.linkFileLocal,   // M
                    'READY',              // N — READY = data lengkap, siap diproses
                    item.chatId,          // O
                    item.nip || '',       // P — NIP Pengusul
                    item.urlDrive || '',  // Q — URL Drive
                    item.tanggal || new Date().toISOString(), // R — Tanggal Pengajuan
                    ''                    // S — Link TTE Final
                ]]
            }
        });

        console.log(`📝 Dokumen '${item.namaDokumen}' ditambahkan ke QUEUE_NEW dengan status READY`);

    } catch (err) {
        console.error('❌ Gagal append ke Spreadsheet:', err.message);
        throw err;
    }
}

async function updateStatus(rowNumber, status) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!N${rowNumber}`,
            valueInputOption: 'RAW',
            requestBody: { values: [[status]] }
        });

        console.log(`📝 Baris ${rowNumber} updated → ${status}`);

    } catch (err) {
        console.error(`❌ Gagal update baris ${rowNumber}:`, err.message);
    }
}

async function updateFinalLink(rowNumber, url) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!S${rowNumber}`,
            valueInputOption: 'RAW',
            requestBody: { values: [[url]] }
        });

        console.log(`🔗 Link Final TTE tersimpan di baris ${rowNumber}`);
    } catch (err) {
        console.error(`❌ Gagal update link final baris ${rowNumber}:`, err.message);
    }
}

async function getLastModifiedTime() {
    try {
        const authClient = await auth.getClient();
        const drive = google.drive({ version: 'v3', auth: authClient });

        const res = await drive.files.get({
            fileId: SPREADSHEET_ID,
            fields: 'modifiedTime'
        });

        return new Date(res.data.modifiedTime).getTime();
    } catch (err) {
        console.error('❌ Gagal mendapatkan modifiedTime:', err.message);
        return null;
    }
}

module.exports = { readRows, appendRow, updateStatus, updateFinalLink, getLastModifiedTime };