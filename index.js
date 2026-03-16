const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { readRows, updateStatus } = require('./sheets');

const loginAdmin = require('./loginAdmin');
const uploadDocument = require('./uploadDocument');
const logout = require('./logout');
const loginSigner = require('./loginSigner');
const signInbox = require('./signInbox');
const downloadFinal = require('./downloadFinal');

(async () => {
    const downloadDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    /* ==========================================
       ADMIN FLOW: UPLOAD DOKUMEN
    ========================================== */
    console.log('\n========== ADMIN FLOW: UPLOAD ==========');

    const adminContext = await browser.newContext({ viewport: null });
    const adminPage = await adminContext.newPage();

    await loginAdmin(adminPage);

    let queue = await readRows();
    const toUpload = queue.filter(item => !item.status && item.tahun > 2025);

    if (toUpload.length > 0) {
        console.log(`📋 Ditemukan ${toUpload.length} dokumen untuk diupload`);

        for (const item of toUpload) {
            console.log(`\n📤 [${toUpload.indexOf(item) + 1}/${toUpload.length}] ${item.nama}`);
            const ok = await uploadDocument(adminPage, item);

            if (ok) {
                await updateStatus(item.row, 'UPLOADED');
                item.status = 'UPLOADED';
                console.log(`✅ ${item.nama} → UPLOADED`);
            } else {
                console.warn(`⚠️ ${item.nama} → GAGAL upload`);
            }
        }

        await logout(adminPage);
    } else {
        console.log('ℹ️ Tidak ada dokumen baru untuk diupload');
    }

    await adminContext.close();

    /* ==========================================
       SIGNER FLOW: TTE
    ========================================== */
    console.log('\n========== SIGNER FLOW: TTE ==========');

    const signerContext = await browser.newContext({ viewport: null });
    const signerPage = await signerContext.newPage();

    await loginSigner(signerPage);

    // Baca ulang agar status UPLOADED terbaru terbaca
    queue = await readRows();
    const toSign = queue.filter(i => i.status === 'UPLOADED' && i.tahun > 2025);

    if (toSign.length > 0) {
        console.log(`📋 Ditemukan ${toSign.length} dokumen untuk ditandatangani`);

        const signedItems = await signInbox(signerPage, toSign);

        for (const item of signedItems) {
            await updateStatus(item.row, 'SIGNED');
            item.status = 'SIGNED';
            console.log(`✅ ${item.nama} → SIGNED`);
        }
    } else {
        console.log('ℹ️ Tidak ada dokumen untuk ditandatangani');
    }

    await logout(signerPage);
    await signerContext.close();

    // Jeda setelah TTE — beri waktu server memproses dokumen yang baru ditandatangani
    console.log('\n⏳ Menunggu server memproses TTE (10 detik)...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    /* ==========================================
       ADMIN FLOW: DOWNLOAD FINAL
    ========================================== */
    console.log('\n========== ADMIN FLOW: DOWNLOAD ==========');

    const downloadContext = await browser.newContext({ viewport: null });
    const downloadPage = await downloadContext.newPage();

    await loginAdmin(downloadPage);

    // Baca ulang untuk status SIGNED terbaru
    queue = await readRows();
    const toDownload = queue.filter(i => i.status === 'SIGNED' && i.tahun > 2025);

    if (toDownload.length > 0) {
        console.log(`📋 Ditemukan ${toDownload.length} dokumen untuk didownload`);

        const downloadedItems = await downloadFinal(downloadPage, toDownload, downloadDir);

        for (const downloaded of downloadedItems) {
            await updateStatus(downloaded.row, 'DOWNLOADED');
            console.log(`✅ ${downloaded.nama} → DOWNLOADED`);
        }
    } else {
        console.log('ℹ️ Tidak ada dokumen untuk didownload');
    }

    await downloadContext.close();
    await browser.close();

    console.log('\n========================================');
    console.log('🎉 SEMUA PROSES SELESAI');
    console.log('========================================');
})();