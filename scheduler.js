const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const { readRows, updateStatus } = require('./sheets');
const { notifyDone, notifyError } = require('./notify');

const loginAdmin = require('./loginAdmin');
const uploadDocument = require('./uploadDocument');
const logout = require('./logout');
const loginKabid = require('./loginKabid');
const signParaf = require('./signParaf');
const loginSigner = require('./loginSigner');
const signInbox = require('./signInbox');
const downloadFinal = require('./downloadFinal');

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

let isRunning = false;

/** Satu jadwal cron boleh beberapa pass — setelah download/TTE, baca ulang sheet jika masih ada READY/dll. */
const MAX_SCHEDULER_PASSES = 5;

// Helper: cek apakah dokumen butuh paraf kabid
function butuhParafKabid(item) {
    const pemarafList = item.pemaraf
        ? item.pemaraf.split(',').map(p => p.trim().toLowerCase())
        : [];
    return pemarafList.includes('kabid');
}

function statusNorm(item) {
    return String(item.status ?? '').trim().toUpperCase();
}

/** Kolom N = SIGNED → unduh / kirim hasil TTE */
function statusKolomNBisaDiunduh(item) {
    return statusNorm(item) === 'SIGNED';
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

/** Ringkas isi sheet: download / paraf / TTE / upload */
function logScanSpreadsheet(queue, pass) {
    const isV = i => i.linkFileLocal && i.penandatangan1 && i.nama;
    const tahunOk = i => i.tahun > 2025;

    const nDownload = queue.filter(i => statusKolomNBisaDiunduh(i) && tahunOk(i)).length;
    const nParaf = queue.filter(i => statusUploaded(i) && tahunOk(i) && butuhParafKabid(i)).length;
    const nTteUploaded = queue.filter(i =>
        statusUploaded(i) && tahunOk(i) && !butuhParafKabid(i)
    ).length;
    const nTteParafed = queue.filter(i => statusParafed(i) && tahunOk(i)).length;
    const nTte = nTteUploaded + nTteParafed;

    const nUploadSiap = queue.filter(i => antrianPerluUpload(i) && tahunOk(i) && isV(i)).length;
    const nUploadKurangData = queue.filter(i => antrianPerluUpload(i) && tahunOk(i) && !isV(i)).length;

    console.log(`\n${'·'.repeat(52)}`);
    console.log(`📊 Scan QUEUE_NEW — pass ${pass + 1}/${MAX_SCHEDULER_PASSES}`);
    console.log(`   DOWNLOAD (N=SIGNED)     : ${nDownload} dokumen`);
    console.log(`   PARAF (N=UPLOADED + kolom C pemaraf kabid) : ${nParaf} dokumen`);
    console.log(`   TTE — dari UPLOADED tanpa kabid: ${nTteUploaded} | dari PARAFED: ${nTteParafed} | total ${nTte}`);
    console.log(`                            Urut proses: UPLOAD → PARAF → TTE → DOWNLOAD`);
    console.log(`   UPLOAD (N kosong / READY): ${nUploadSiap} siap | ${nUploadKurangData} data tidak lengkap`);
    console.log(`${'·'.repeat(52)}`);
}

async function runRPA() {
    if (isRunning) {
        console.log('⏳ RPA masih berjalan, skip giliran ini...');
        return;
    }

    isRunning = true;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🤖 RPA dimulai: ${new Date().toLocaleString('id-ID')}`);
    console.log('='.repeat(50));

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        for (let pass = 0; pass < MAX_SCHEDULER_PASSES; pass++) {
            const queue = await readRows();
            const isValid = i => i.linkFileLocal && i.penandatangan1 && i.nama;

            logScanSpreadsheet(queue, pass);

            const toUpload = queue.filter(i => antrianPerluUpload(i) && i.tahun > 2025 && isValid(i));

            const invalidRows = queue.filter(i => antrianPerluUpload(i) && i.tahun > 2025 && !isValid(i));
            if (invalidRows.length > 0) {
                console.warn(`⚠️ ${invalidRows.length} baris (N kosong/READY) dilewati — data tidak lengkap:`);
                invalidRows.forEach(i => console.warn(`   - Baris ${i.row}: ${i.nama || '(tanpa nama)'}`));
            }

            const toParaf = queue.filter(i =>
                statusUploaded(i) && i.tahun > 2025 && butuhParafKabid(i)
            );
            const toSign = queue.filter(i =>
                (statusParafed(i) || (statusUploaded(i) && !butuhParafKabid(i))) &&
                i.tahun > 2025
            );
            const toDownload = queue.filter(i => statusKolomNBisaDiunduh(i) && i.tahun > 2025);

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
            }

            /* ========== KABID: PARAF ELEKTRONIK ========== */
            const queueAfterUpload = await readRows();
            const toParafFinal = queueAfterUpload.filter(i =>
                statusUploaded(i) && i.tahun > 2025 && butuhParafKabid(i)
            );

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
                i.tahun > 2025
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
                    const newStatus = hasMultiSigner ? 'DRAFT' : 'SIGNED';

                    await updateStatus(item.row, newStatus);
                    console.log(`✅ ${item.nama} → ${newStatus}`);
                }

                await logout(signerPage);
                await signerCtx.close();
                console.log('\n⏳ Menunggu server memproses TTE (10 detik)...');
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            /* ========== ADMIN: DOWNLOAD (hanya baris kolom N = SIGNED) ========== */
            const queueAfterSign = await readRows();
            const toDownloadFinal = queueAfterSign.filter(i => statusKolomNBisaDiunduh(i) && i.tahun > 2025);

            if (toDownloadFinal.length > 0) {
                // Jalankan download 1 per 1 per pass untuk mengisolasi error per dokumen.
                const batch = toDownloadFinal.slice(0, 1);
                console.log(`\n========== DOWNLOAD (1 dari ${toDownloadFinal.length} dokumen SIGNED) ==========`);
                const dlCtx = await browser.newContext({ viewport: null });
                const dlPage = await dlCtx.newPage();
                dlPage.setDefaultTimeout(60000);
                await loginAdmin(dlPage);

                const downloadedItems = await downloadFinal(dlPage, batch, downloadDir);
                for (const item of downloadedItems) {
                    if (item.chatId) {
                        const terkirim = await notifyDone(item.chatId, item.nama, item.buffer, item.filename);
                        if (terkirim) {
                            await updateStatus(item.row, 'SENT');
                            console.log(`✅ ${item.nama} → SENT (terkirim ke Telegram)`);
                        } else {
                            await updateStatus(item.row, 'DOWNLOADED');
                            console.log(`⚠️ ${item.nama} → DOWNLOADED (gagal kirim Telegram)`);
                        }
                    } else {
                        await updateStatus(item.row, 'DOWNLOADED');
                        console.log(`✅ ${item.nama} → DOWNLOADED (disimpan ke disk)`);
                    }
                }
                await dlCtx.close();
            }

        } /* end for pass */

        const sisa = await readRows();
        const masih = {
            upload: sisa.filter(i => antrianPerluUpload(i) && i.tahun > 2025 && i.linkFileLocal && i.penandatangan1 && i.nama).length,
            paraf: sisa.filter(i => statusUploaded(i) && i.tahun > 2025 && butuhParafKabid(i)).length,
            tte: sisa.filter(i => (statusParafed(i) || (statusUploaded(i) && !butuhParafKabid(i))) && i.tahun > 2025).length,
            unduh: sisa.filter(i => statusKolomNBisaDiunduh(i) && i.tahun > 2025).length
        };
        if (masih.upload || masih.paraf || masih.tte || masih.unduh) {
            console.log(
                `\n📌 Ringkasan antrian setelah pass terakhir: ` +
                `UPLOAD ${masih.upload} | PARAF ${masih.paraf} | TTE ${masih.tte} | DOWNLOAD ${masih.unduh}`
            );
            console.log(`   (Jika masih >0 dan cap ${MAX_SCHEDULER_PASSES} pass, sisa diproses jadwal cron berikutnya)`);
        }

    } catch (err) {
        console.error('❌ Error tidak terduga di RPA:', err.message);
    } finally {
        await browser.close();
        isRunning = false;
        console.log(`\n✅ RPA selesai: ${new Date().toLocaleString('id-ID')}`);
    }
}

console.log('⏰ Scheduler aktif — RPA akan jalan setiap 5 menit');
console.log('   Ketik Ctrl+C untuk menghentikan\n');

runRPA();
cron.schedule('*/2 * * * *', () => { runRPA(); });
