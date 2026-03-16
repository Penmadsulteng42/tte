const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');



const { readRows, updateStatus } = require('./sheets');
const { notifyDone, notifyError } = require('./notify');

const loginAdmin = require('./loginAdmin');
const uploadDocument = require('./uploadDocument');
const logout = require('./logout');
const loginSigner = require('./loginSigner');
const signInbox = require('./signInbox');
const downloadFinal = require('./downloadFinal');

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

let isRunning = false; // Cegah RPA jalan bersamaan

// ============================================================
//  FUNGSI UTAMA RPA
// ============================================================
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
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    // Set default timeout 60 detik untuk semua operasi
    browser.defaultBrowserContext().setDefaultTimeout = 60000;

    try {
        const queue = await readRows();

        const toUpload = queue.filter(i => !i.status && i.tahun > 2025);
        const toSign = queue.filter(i => i.status === 'UPLOADED' && i.tahun > 2025);
        const toDownload = queue.filter(i => i.status === 'SIGNED' && i.tahun > 2025);

        // Jika tidak ada yang perlu diproses, skip
        if (toUpload.length === 0 && toSign.length === 0 && toDownload.length === 0) {
            console.log('ℹ️ Tidak ada dokumen yang perlu diproses');
            await browser.close();
            isRunning = false;
            return;
        }

        /* ==========================================
           ADMIN FLOW: UPLOAD
        ========================================== */
        if (toUpload.length > 0) {
            console.log(`\n========== UPLOAD (${toUpload.length} dokumen) ==========`);

            const adminCtx = await browser.newContext({ viewport: null });
            const adminPage = await adminCtx.newPage();
            adminPage.setDefaultTimeout(60000);
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

        /* ==========================================
           SIGNER FLOW: TTE
        ========================================== */
        // Baca ulang setelah upload
        const queueAfterUpload = await readRows();
        const toSignFinal = queueAfterUpload.filter(i => i.status === 'UPLOADED' && i.tahun > 2025);

        if (toSignFinal.length > 0) {
            console.log(`\n========== TANDA TANGAN (${toSignFinal.length} dokumen) ==========`);

            const signerCtx = await browser.newContext({ viewport: null });
            const signerPage = await signerCtx.newPage();
            signerPage.setDefaultTimeout(60000);
            await loginSigner(signerPage);

            const signedItems = await signInbox(signerPage, toSignFinal);

            for (const item of signedItems) {
                await updateStatus(item.row, 'SIGNED');
                console.log(`✅ ${item.nama} → SIGNED`);
            }

            await logout(signerPage);
            await signerCtx.close();

            // Jeda setelah TTE selesai
            console.log('\n⏳ Menunggu server memproses TTE (10 detik)...');
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        /* ==========================================
           ADMIN FLOW: DOWNLOAD
        ========================================== */
        // Baca ulang setelah sign
        const queueAfterSign = await readRows();
        const toDownloadFinal = queueAfterSign.filter(i => i.status === 'SIGNED' && i.tahun > 2025);

        if (toDownloadFinal.length > 0) {
            console.log(`\n========== DOWNLOAD (${toDownloadFinal.length} dokumen) ==========`);

            const dlCtx = await browser.newContext({ viewport: null });
            const dlPage = await dlCtx.newPage();
            dlPage.setDefaultTimeout(60000);
            await loginAdmin(dlPage);

            const downloadedItems = await downloadFinal(dlPage, toDownloadFinal, downloadDir);

            for (const item of downloadedItems) {
                if (item.chatId) {
                    // Ada chatId → kirim PDF dari buffer langsung ke Telegram
                    const terkirim = await notifyDone(item.chatId, item.nama, item.buffer, item.filename);
                    if (terkirim) {
                        await updateStatus(item.row, 'SENT');
                        console.log(`✅ ${item.nama} → SENT (terkirim ke Telegram)`);
                    } else {
                        await updateStatus(item.row, 'DOWNLOADED');
                        console.log(`⚠️ ${item.nama} → DOWNLOADED (gagal kirim Telegram)`);
                    }
                } else {
                    // Tidak ada chatId → sudah disimpan ke disk di downloadFinal
                    await updateStatus(item.row, 'DOWNLOADED');
                    console.log(`✅ ${item.nama} → DOWNLOADED (disimpan ke disk)`);
                }
            }

            await dlCtx.close();
        }

    } catch (err) {
        console.error('❌ Error tidak terduga di RPA:', err.message);
    } finally {
        await browser.close();
        isRunning = false;
        console.log(`\n✅ RPA selesai: ${new Date().toLocaleString('id-ID')}`);
    }
}

// ============================================================
//  JADWAL: Jalankan RPA setiap 5 menit
//  Format cron: '*/5 * * * *' = setiap 5 menit
//  Ganti angka 5 sesuai kebutuhan
// ============================================================
console.log('⏰ Scheduler aktif — RPA akan jalan setiap 5 menit');
console.log('   Ketik Ctrl+C untuk menghentikan\n');

// Jalankan sekali saat pertama start
runRPA();

// Jadwalkan berikutnya
cron.schedule('*/1 * * * *', () => {
    runRPA();
});