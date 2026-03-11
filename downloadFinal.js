const fs = require('fs');
const path = require('path');
const { url } = require('./config');
const { docKey, safeFilename } = require('./utils');

/**
 * Cari dokumen di tabel admin (halaman unggah) semua halaman
 * Hanya ambil baris yang kolom Unduh-nya ada tombol FINAL
 */
async function cariDiTabel(page, namaCari) {
    let currentPage = 1;

    while (true) {
        await page.waitForSelector('table tbody tr', { timeout: 10000 });

        const rows = page.locator('table tbody tr');
        const count = await rows.count();

        console.log(`   🔍 Halaman ${currentPage}: ${count} baris`);

        for (let i = 0; i < count; i++) {
            const row = rows.nth(i);

            // Struktur kolom: # | Waktu | Perihal Dokumen | Instansi | Status | Pemaraf | Penandatangan | Unduh
            const waktu = (await row.locator('td').nth(1).innerText()).trim();
            const nama = (await row.locator('td').nth(2).innerText()).trim();

            // Cocokkan nama dokumen
            const cocok =
                nama.toLowerCase().includes(namaCari.toLowerCase()) ||
                namaCari.toLowerCase().includes(nama.toLowerCase());

            if (!cocok) continue;

            // Pastikan kolom Unduh punya tombol FINAL
            const finalBtn = row.locator('a[href*="keaslian"], a[href*="signed_dokumen"]');
            const hasFinal = await finalBtn.count() > 0;

            if (!hasFinal) {
                console.log(`   ⚠️ Ditemukan '${nama}' tapi tombol FINAL belum tersedia`);
                continue;
            }

            console.log(`   ✓ Ditemukan di halaman ${currentPage}: ${nama}`);
            return { waktu, nama, row, finalBtn };
        }

        // Cek tombol Next
        const nextBtn = page.locator([
            'li.paginate_button.next:not(.disabled) a',
            'a[data-dt-idx]:has-text("Next")',
            'a.page-link:has-text("›")',
            'a.page-link:has-text("Next")'
        ].join(', '));

        const hasNext = await nextBtn.count() > 0;
        if (!hasNext) {
            console.log(`   ⚠️ Tidak ditemukan sampai halaman terakhir (${currentPage})`);
            return null;
        }

        await nextBtn.first().click();
        await page.waitForTimeout(1500);
        currentPage++;
    }
}

/**
 * Download dokumen FINAL dari halaman admin
 *
 * @param {object} page        - Playwright page (admin)
 * @param {Array}  queueItems  - Array item dari readRows() dengan status SIGNED
 * @param {string} downloadDir - Direktori tujuan download
 * @returns {Array} downloadedItems
 */
module.exports = async function downloadFinal(page, queueItems, downloadDir) {
    await page.goto(url.download, { waitUntil: 'networkidle' });
    await page.waitForSelector('table tbody tr');

    console.log(`\n📋 Total queue SIGNED: ${queueItems.length} dokumen`);

    const downloadedItems = [];

    // -------------------------------------------------------
    // ITERASI PER ITEM QUEUE
    // -------------------------------------------------------
    for (let q = 0; q < queueItems.length; q++) {
        const item = queueItems[q];
        console.log(`\n[${q + 1}/${queueItems.length}] Mencari: ${item.nama}`);

        // Kembali ke halaman 1 setiap kali cari dokumen baru
        await page.goto(url.download, { waitUntil: 'networkidle' });
        await page.waitForSelector('table tbody tr');

        // Cari di semua halaman tabel
        const found = await cariDiTabel(page, item.nama);

        if (!found) {
            console.log(`   ❌ '${item.nama}' tidak ditemukan atau belum FINAL, dilewati`);
            continue;
        }

        // Download via popup
        try {
            const [popup] = await Promise.all([
                page.waitForEvent('popup', { timeout: 15000 }),
                found.finalBtn.first().click()
            ]);

            await popup.waitForLoadState('networkidle', { timeout: 15000 });

            const pdfUrl = popup.url();
            if (!pdfUrl || pdfUrl === 'about:blank') {
                throw new Error('Popup URL kosong / belum siap');
            }

            const response = await page.context().request.get(pdfUrl, { timeout: 30000 });
            if (!response.ok()) {
                throw new Error(`HTTP ${response.status()} saat fetch PDF`);
            }

            const buffer = await response.body();
            const filename = safeFilename(found.waktu, found.nama);
            const filepath = path.join(downloadDir, filename);

            fs.writeFileSync(filepath, buffer);

            const fileSize = fs.statSync(filepath).size;
            if (fileSize === 0) {
                fs.unlinkSync(filepath);
                throw new Error('File 0 bytes');
            }

            console.log(`   ✅ ${filename} (${(fileSize / 1024).toFixed(1)} KB)`);

            await popup.close();
            await page.waitForTimeout(2000);

            downloadedItems.push({
                row: item.row,
                key: docKey(found.waktu, found.nama),
                filename,
                nama: item.nama
            });

        } catch (err) {
            console.error(`   ❌ Gagal download [${item.nama}]: ${err.message}`);

            try {
                const allPages = page.context().pages();
                for (const p of allPages) {
                    if (p !== page) await p.close();
                }
            } catch (_) { }

            await page.waitForTimeout(2000);
        }
    }

    // Ringkasan
    console.log('\n========================================');
    console.log('📊 Hasil Download');
    console.log(`   Berhasil : ${downloadedItems.length} dokumen`);
    console.log(`   Gagal    : ${queueItems.length - downloadedItems.length} dokumen`);
    console.log('========================================');

    return downloadedItems;
};