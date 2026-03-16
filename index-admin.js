const { chromium } = require('playwright');

const loginAdmin = require('./loginAdmin');
const uploadDocument = require('./uploadDocument');
const logout = require('./logout');
const { readRows, updateStatus } = require('./sheets');

(async () => {
    console.log('\n========================================');
    console.log('   TTE AUTOMATION — ADMIN FLOW');
    console.log('========================================\n');

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const adminContext = await browser.newContext({
        viewport: null  // ← wajib null agar mengikuti ukuran layar penuh
    });

    const page = await adminContext.newPage();

    try {
        // 1. Login sebagai Admin
        await loginAdmin(page);

        // 2. Baca queue dari Sheets
        const queue = await readRows();
        console.log(`📋 Total data di QUEUE_NEW: ${queue.length} baris`);

        // 3. Filter: status kosong dan tahun > 2025
        const toUpload = queue.filter(item => !item.status && item.tahun > 2025);

        if (toUpload.length === 0) {
            console.log('ℹ️ Tidak ada dokumen baru untuk diupload');
            await adminContext.close();
            await browser.close();
            return;
        }

        console.log(`🚀 Ditemukan ${toUpload.length} dokumen untuk diupload\n`);

        // 4. Proses upload satu per satu
        let berhasil = 0;
        let gagal = 0;

        for (const item of toUpload) {
            console.log(`\n📤 [${berhasil + gagal + 1}/${toUpload.length}] ${item.nama}`);

            const success = await uploadDocument(page, item);

            if (success) {
                await updateStatus(item.row, 'UPLOADED');
                berhasil++;
                console.log(`✅ ${item.nama} → UPLOADED`);
            } else {
                gagal++;
                console.warn(`⚠️ ${item.nama} → GAGAL, status tidak diupdate`);
            }
        }

        // 5. Logout
        await logout(page);

        // 6. Ringkasan
        console.log('\n========================================');
        console.log('📊 SELESAI');
        console.log(`   Berhasil : ${berhasil} dokumen`);
        console.log(`   Gagal    : ${gagal} dokumen`);
        console.log('========================================\n');

    } catch (err) {
        console.error('❌ Error tidak terduga:', err.message);
    } finally {
        await adminContext.close();
        await browser.close();
    }
})();