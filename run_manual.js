const { chromium } = require('playwright');
const { readRows, updateStatus, updateFinalLink, getLastModifiedTime } = require('./sheets');
const { notifyDone, notifyError } = require('./notify');
const loginAdmin = require('./loginAdmin');
const uploadDocument = require('./uploadDocument');
const logout = require('./logout');
const loginKabid = require('./loginKabid');
const signParaf = require('./signParaf');
const loginSigner = require('./loginSigner');
const signInbox = require('./signInbox');
const downloadFinal = require('./downloadFinal');
const path = require('path');
const fs = require('fs');

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

let isRunning = false;

/** Satu jadwal cron boleh beberapa pass — setelah download/TTE, baca ulang sheet jika masih ada READY/dll. */
const MAX_SCHEDULER_PASSES = 5;

// Helper: cek apakah dokumen butuh paraf kabid
function butuhParafKabid(item) {
    const pemarafText = String(item.pemaraf || '').toLowerCase().trim();
    if (!pemarafText) return false;

    // Cocokkan kata kabid di mana pun di teks.
    return /\bkabid\b/.test(pemarafText);
}

function statusNorm(item) {
    return String(item.status ?? '').trim().toUpperCase();
}

/** Kolom N = SIGNED atau FINAL → unduh / kirim hasil TTE */
function statusKolomNBisaDiunduh(item) {
    return ['SIGNED', 'FINAL'].includes(statusNorm(item));
}

/**
 * Kolom N kosong / NULL / READY → antrian upload (baris manual sheet sering lupa isi status).
 * Status lain (UPLOADED, PARAFED, …) bukan upload.
 */
function antrianPerluUpload(item) {
    const s = statusNorm(item);
    return s === '' || s === 'READY';
}

function statusUploaded(item) {
    return statusNorm(item) === 'UPLOADED';
}

function statusParafed(item) {
    return statusNorm(item) === 'PARAFED';
}

function statusDraft(item) {
    return statusNorm(item) === 'DRAFT';
}

/**
 * Ekstrak angka tahun dari berbagai format kolom L:
 *   2026                    → 2026  (angka langsung dari getFullYear())
 *   "2026"                  → 2026  (string angka)
 *   "20/04/2026 10:53:55"   → 2026  (format dd/mm/yyyy hh:mm:ss)
 *   "2026-04-20T01:07:35Z"  → 2026  (ISO string, fallback)
 */
function getYearFromTahun(val) {
    if (!val) return 0;
    const s = String(val).trim();

    // Format dd/mm/yyyy (dengan atau tanpa jam)
    const dmyMatch = s.match(/^\d{2}\/\d{2}\/(\d{4})/);
    if (dmyMatch) return parseInt(dmyMatch[1], 10);

    // Angka murni atau string angka: "2026" / 2025
    const num = parseInt(s, 10);
    if (!isNaN(num) && num > 1900 && num < 2100) return num;

    // Cari tahun 4-digit dalam teks: "T.A. 2025", "dokumen 2025"
    const anyYearMatch = s.match(/(19|20)\d{2}/);
    if (anyYearMatch) return parseInt(anyYearMatch[0], 10);

    // Fallback: parse sebagai Date (ISO, dll)
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.getFullYear();

    return 0;
}

function tahunValid(item) {
    return getYearFromTahun(item.tahun) >= 2025;
}

/**
 * Fungsi baru: Periksa status di aplikasi TTE untuk dokumen UPLOADED/PARAFED/DRAFT.
 * Jika sudah final (Sukses + tombol FINAL), update status di spreadsheet ke SIGNED dan langsung download.
 */
async function checkAndUpdateSignedStatus(browser, queue) {
    // 1. Filter hanya dokumen yang masih DRAFT/UPLOADED/PARAFED/FINAL
    const itemsToCheck = queue.filter(item =>
        ['DRAFT', 'UPLOADED', 'PARAFED', 'FINAL'].includes(item.status?.toUpperCase())
    );

    if (itemsToCheck.length === 0) return;

    const page = await browser.newPage();
    try {
        await loginAdmin(page); // Login sekali saja di awal

        for (const item of itemsToCheck) {
            // Gunakan fungsi cariDiTabel yang sudah kita optimasi dengan Search Box
            const result = await downloadFinal.cariDiTabel(page, item.nama);

            if (result && result.finalBtn) {
                console.log(`✅ Dokumen "${item.nama}" terdeteksi FINAL di web.`);

                // Hanya update status ke SIGNED bila belum berstatus FINAL.
                if (statusNorm(item) !== 'FINAL') {
                    await updateStatus(item.row, 'SIGNED');
                }

                // LANGSUNG DOWNLOAD & KIRIM (Tanpa Menunggu Cron Berikutnya)
                console.log(`📥 Memulai download otomatis untuk ${item.nama}...`);
                const processed = await downloadFinal(browser, [item]);

                if (processed && processed.length > 0) {
                    const doc = processed[0];

                    if (doc.finalUrl) {
                        await updateFinalLink(item.row, doc.finalUrl);
                    }

                    const terkirim = await notifyDone(item.chatId, item.nama, doc.buffer, doc.filename);
                    if (terkirim) {
                        await updateStatus(item.row, 'SENT');
                    }
                }
            } else {
                console.log(`⏳ Dokumen "${item.nama}" masih dalam proses (belum Final).`);
            }
        }
    } finally {
        await page.close();
    }
}

/** Ringkas isi sheet: download / paraf / TTE / upload */
function logScanSpreadsheet(queue, pass) {
    const isV = i => i.linkFileLocal && i.penandatangan1 && i.nama;
    const tahunOk = i => tahunValid(i);

    const parafItems = queue.filter(i => statusUploaded(i) && tahunOk(i) && butuhParafKabid(i));
    const nDownload = queue.filter(i => statusKolomNBisaDiunduh(i) && tahunOk(i)).length;
    const nParaf = parafItems.length;
    const nTteUploaded = queue.filter(i =>
        statusUploaded(i) && tahunOk(i) && !butuhParafKabid(i)
    ).length;
    const nTteParafed = queue.filter(i => statusParafed(i) && tahunOk(i)).length;
    const nTte = nTteUploaded + nTteParafed;

    const nUploadSiap = queue.filter(i => antrianPerluUpload(i) && tahunOk(i) && isV(i)).length;
    const nUploadKurangData = queue.filter(i => antrianPerluUpload(i) && tahunOk(i) && !isV(i)).length;

    const parafNames = parafItems.map(i => i.nama).join('; ');

    console.log(`\n${'·'.repeat(52)}`);
    console.log(`📊 Scan QUEUE_NEW — pass ${pass + 1}/${MAX_SCHEDULER_PASSES}`);
    console.log(`   DOWNLOAD (N=SIGNED)     : ${nDownload} dokumen`);
    console.log(`   PARAF (N=UPLOADED + kolom C pemaraf kabid) : ${nParaf} dokumen${parafNames ? ` → ${parafNames}` : ''}`);
    console.log(`   TTE — dari UPLOADED tanpa kabid: ${nTteUploaded} | dari PARAFED: ${nTteParafed} | total ${nTte}`);
    console.log(`                            Urut proses: UPLOAD → PARAF → TTE → DOWNLOAD`);
    console.log(`   UPLOAD (N kosong / READY): ${nUploadSiap} siap | ${nUploadKurangData} data tidak lengkap`);
    console.log(`${'·'.repeat(52)}`);
}

const LAST_MODIFIED_FILE = path.join(__dirname, 'last_modified.json');

async function runRPA() {
    if (isRunning) {
        console.log('⏳ RPA sedang berjalan, skip...');
        return;
    }
    isRunning = true;

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        for (let pass = 0; pass < MAX_SCHEDULER_PASSES; pass++) {
            const queue = await readRows();
            const isValid = i => i.linkFileLocal && i.penandatangan1 && i.nama;

            // Periksa status di aplikasi TTE untuk dokumen yang sudah diupload/paraf
            await checkAndUpdateSignedStatus(browser, queue);

            // Baca ulang queue setelah update status
            const updatedQueue = await readRows();

            logScanSpreadsheet(updatedQueue, pass);

            const toUpload = updatedQueue.filter(i => antrianPerluUpload(i) && tahunValid(i) && isValid(i));

            const invalidRows = updatedQueue.filter(i => antrianPerluUpload(i) && tahunValid(i) && !isValid(i));
            if (invalidRows.length > 0) {
                console.warn(`⚠️ ${invalidRows.length} baris (N kosong/READY) dilewati — data tidak lengkap:`);
                invalidRows.forEach(i => console.warn(`   - Baris ${i.row}: ${i.nama || '(tanpa nama)'}`));
            }

            const toParaf = updatedQueue.filter(i =>
                statusUploaded(i) && tahunValid(i) && butuhParafKabid(i)
            );
            const toSign = updatedQueue.filter(i =>
                (statusParafed(i) || (statusUploaded(i) && !butuhParafKabid(i))) &&
                tahunValid(i)
            );
            const toDownload = updatedQueue.filter(i => statusKolomNBisaDiunduh(i) && tahunValid(i));

            if (toUpload.length === 0 && toParaf.length === 0 && toSign.length === 0 && toDownload.length === 0) {
                if (pass === 0) {
                    console.log('ℹ️ Tidak ada dokumen yang perlu diproses (setelah filter tahun>2025)');
                }
                break;
            }

            if (pass > 0) {
                console.log(`\n${'─'.repeat(50)}`);
                console.log(`🔄 Pass ${pass + 1}/${MAX_SCHEDULER_PASSES} — spreadsheet dibaca ulang, masih ada antrian`);
                console.log(`${'─'.repeat(50)}`);
            }

            /* ========== ADMIN: UPLOAD ========== */
            if (toUpload.length > 0) {
                console.log(`\n========== UPLOAD (${toUpload.length} dokumen) ==========`);
                const adminCtx = await browser.newContext({ viewport: null, ignoreHTTPSErrors: true });
                const adminPage = await adminCtx.newPage();
                adminPage.setDefaultTimeout(60000);
                await adminPage.goto('https://tte.kemenag.go.id/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
                await loginAdmin(adminPage);

                for (const item of toUpload) {
                    const ok = await uploadDocument(adminPage, item);
                    if (ok) {
                        await updateStatus(item.row, 'UPLOADED');
                        console.log(`✅ ${item.nama} → UPLOADED`);
                    } else {
                        console.warn(`⚠️ ${item.nama} → GAGAL upload`);
                        await notifyError(item.chatId, item.nama, 'Gagal pada proses upload dokumen.');
                    }
                }
                await logout(adminPage);
                await adminCtx.close();
                console.log('⏳ Menunggu server memproses upload ke inbox Kabid (10 detik)...');
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            /* ========== KABID: PARAF ELEKTRONIK ========== */
            const queueAfterUpload = await readRows();
            const toParafFinal = queueAfterUpload.filter(i =>
                statusUploaded(i) && tahunValid(i) && butuhParafKabid(i)
            );
            const toParafNames = toParafFinal.map(i => `${i.nama} [${i.pemaraf}]`).join('; ');

            console.log(`\n   Kandidat PARAF KABID: ${toParafFinal.length} dokumen${toParafNames ? ` → ${toParafNames}` : ''}`);

            if (toParafFinal.length > 0) {
                console.log(`\n========== PARAF KABID (${toParafFinal.length} dokumen) ==========`);
                const kabidCtx = await browser.newContext({ viewport: null });
                const kabidPage = await kabidCtx.newPage();
                kabidPage.setDefaultTimeout(60000);
                await loginKabid(kabidPage);

                const parafedItems = await signParaf(kabidPage, toParafFinal);
                for (const item of parafedItems) {
                    await updateStatus(item.row, 'PARAFED');
                    console.log(`✅ ${item.nama} → PARAFED`);
                }

                await logout(kabidPage);
                await kabidCtx.close();
                console.log('\n⏳ Menunggu server memproses paraf (5 detik)...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            /* ========== SIGNER: TTE (PARAFED + UPLOADED tanpa kabid) ========== */
            const queueAfterParaf = await readRows();
            const toSignFinal = queueAfterParaf.filter(i =>
                (statusParafed(i) || (statusUploaded(i) && !butuhParafKabid(i))) &&
                tahunValid(i)
            );

            if (toSignFinal.length > 0) {
                console.log(`\n========== TANDA TANGAN (${toSignFinal.length} dokumen) ==========`);
                const signerCtx = await browser.newContext({ viewport: null });
                const signerPage = await signerCtx.newPage();
                signerPage.setDefaultTimeout(60000);
                await loginSigner(signerPage);

                const signedItems = await signInbox(signerPage, toSignFinal);
                for (const item of signedItems) {
                    const hasMultiSigner =
                        (item.penandatangan2 && String(item.penandatangan2).trim()) ||
                        (item.penandatangan3 && String(item.penandatangan3).trim()) ||
                        (item.penandatangan4 && String(item.penandatangan4).trim());

                    if (hasMultiSigner) {
                        await updateStatus(item.row, 'DRAFT');
                        console.log(`✅ ${item.nama} → DRAFT (multi-signer)`);
                    } else {
                        await updateStatus(item.row, 'SIGNED');
                        console.log(`✅ ${item.nama} → SIGNED`);
                    }
                }

                await logout(signerPage);
                await signerCtx.close();
            }

            /* ========== DOWNLOAD FINAL ========== */
            const queueAfterSign = await readRows();
            const toDownloadFinal = queueAfterSign.filter(i => statusKolomNBisaDiunduh(i) && tahunValid(i));

            if (toDownloadFinal.length > 0) {
                console.log(`\n========== DOWNLOAD (${toDownloadFinal.length} dokumen) ==========`);
                const downloadCtx = await browser.newContext({ viewport: null });
                const downloadPage = await downloadCtx.newPage();
                downloadPage.setDefaultTimeout(60000);
                await loginAdmin(downloadPage);

                const processed = await downloadFinal(browser, toDownloadFinal);
                for (const doc of processed) {
                    const item = toDownloadFinal.find(i => i.nama === doc.nama);
                    if (item) {
                        if (doc.finalUrl) {
                            await updateFinalLink(item.row, doc.finalUrl);
                        }

                        const terkirim = await notifyDone(item.chatId, item.nama, doc.buffer, doc.filename);
                        if (terkirim) {
                            await updateStatus(item.row, 'SENT');
                            console.log(`✅ ${item.nama} → SENT`);
                        } else {
                            await updateStatus(item.row, 'DOWNLOADED');
                            console.log(`✅ ${item.nama} → DOWNLOADED`);
                        }
                    }
                }

                await logout(downloadPage);
                await downloadCtx.close();
            }

            // Jika masih ada antrian, baca ulang dan lanjut pass berikutnya
            const sisa = await readRows();
            const masih = {
                upload: sisa.filter(i => antrianPerluUpload(i) && tahunValid(i) && isValid(i)).length,
                paraf: sisa.filter(i => statusUploaded(i) && tahunValid(i) && butuhParafKabid(i)).length,
                tte: sisa.filter(i => (statusParafed(i) || (statusUploaded(i) && !butuhParafKabid(i))) && tahunValid(i)).length,
                unduh: sisa.filter(i => statusKolomNBisaDiunduh(i) && tahunValid(i)).length
            };

            if (masih.upload || masih.paraf || masih.tte || masih.unduh) {
                console.log(`\n⏳ Masih ada antrian: UPLOAD ${masih.upload} | PARAF ${masih.paraf} | TTE ${masih.tte} | DOWNLOAD ${masih.unduh}`);
                if (pass + 1 < MAX_SCHEDULER_PASSES) {
                    console.log('   → Lanjut pass berikutnya...');
                }
            } else {
                console.log('\n✅ Semua antrian selesai diproses.');
                break;
            }
        }
    } finally {
        await browser.close();
        isRunning = false;
    }
}

runRPA().then(() => console.log('RPA selesai')).catch(console.error);