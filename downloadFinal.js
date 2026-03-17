const fs   = require('fs');
const path = require('path');
const { url }                  = require('./config');
const { docKey, safeFilename } = require('./utils');

/**
 * Cari dokumen di tabel admin semua halaman
 */
async function cariDiTabel(page, namaCari) {
    let currentPage = 1;

    while (true) {
        await page.waitForSelector('table tbody tr', { timeout: 120000 });

        const rows  = page.locator('table tbody tr');
        const count = await rows.count();
        console.log(`   🔍 Halaman ${currentPage}: ${count} baris`);

        for (let i = 0; i < count; i++) {
            const row   = rows.nth(i);
            const waktu = (await row.locator('td').nth(1).innerText()).trim();
            const nama  = (await row.locator('td').nth(2).innerText()).trim();

            const cocok =
                nama.toLowerCase().includes(namaCari.toLowerCase()) ||
                namaCari.toLowerCase().includes(nama.toLowerCase());

            if (!cocok) continue;

            // Cek kolom Status — harus "Sukses" agar semua penandatangan sudah selesai
            const statusTd  = await row.locator('td').nth(4).innerText();
            const isSukses  = statusTd.toLowerCase().includes('sukses');

            if (!isSukses) {
                console.log(`   ⚠️ Ditemukan '${nama}' tapi status: ${statusTd.trim()} (belum Sukses), dilewati`);
                continue;
            }

            // Cek tombol FINAL di kolom Unduh
            const finalBtn = row.locator('a[href*="keaslian"], a[href*="signed_dokumen"]');
            const hasFinal = await finalBtn.count() > 0;

            if (!hasFinal) {
                console.log(`   ⚠️ Ditemukan '${nama}' status Sukses tapi tombol FINAL belum tersedia`);
                continue;
            }

            console.log(`   ✓ Ditemukan di halaman ${currentPage}: ${nama} (Status: Sukses)`);
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
 * Proses dokumen FINAL:
 * - Klik tombol FINAL → tunggu popup → ambil URL PDF dari popup
 * - Fetch PDF ke buffer memory
 * - Jika ada chatId → kirim ke Telegram (tidak simpan ke disk)
 * - Jika tidak ada chatId → simpan ke disk
 */
module.exports = async function downloadFinal(page, queueItems, downloadDir) {
    await page.goto(url.download, { waitUntil: 'load', timeout: 120000 });
    await page.waitForSelector('table tbody tr');

    console.log(`\n📋 Total queue SIGNED: ${queueItems.length} dokumen`);

    const processedItems = [];

    for (let q = 0; q < queueItems.length; q++) {
        const item = queueItems[q];
        console.log(`\n[${q + 1}/${queueItems.length}] Mencari: ${item.nama}`);

        // Kembali ke halaman 1 untuk setiap dokumen
        await page.goto(url.download, { waitUntil: 'load', timeout: 120000 });
        await page.waitForSelector('table tbody tr');

        const found = await cariDiTabel(page, item.nama);

        if (!found) {
            console.log(`   ❌ '${item.nama}' tidak ditemukan atau belum FINAL, dilewati`);
            continue;
        }

        try {
            // Klik tombol FINAL → tunggu popup muncul
            const [popup] = await Promise.all([
                page.waitForEvent('popup', { timeout: 120000 }),
                found.finalBtn.first().click()
            ]);

            await popup.waitForLoadState('load', { timeout: 120000 });

            // Ambil URL PDF dari popup — ini URL dokumen yang sudah ditandatangani
            const pdfUrl = popup.url();
            if (!pdfUrl || pdfUrl === 'about:blank') {
                await popup.close();
                throw new Error('Popup URL kosong / belum siap');
            }

            console.log(`   🔗 PDF URL: ${pdfUrl}`);

            // Fetch PDF ke buffer memory menggunakan context request
            const response = await page.context().request.get(pdfUrl, { timeout: 120000 });

            if (!response.ok()) {
                await popup.close();
                throw new Error(`HTTP ${response.status()} saat fetch PDF`);
            }

            const buffer   = await response.body();
            const filename = safeFilename(found.waktu, found.nama);

            if (!buffer || buffer.length === 0) {
                await popup.close();
                throw new Error('Buffer PDF kosong / 0 bytes');
            }

            console.log(`   ✅ PDF berhasil: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);

            await popup.close();
            await page.waitForTimeout(2000);

            processedItems.push({
                row:      item.row,
                key:      docKey(found.waktu, found.nama),
                filename,
                nama:     item.nama,
                chatId:   item.chatId,
                buffer,           // PDF di memory — langsung kirim ke Telegram
                filepath: null    // diisi jika perlu simpan ke disk
            });

        } catch (err) {
            console.error(`   ❌ Gagal [${item.nama}]: ${err.message}`);

            // Tutup popup yang mungkin masih terbuka
            try {
                const allPages = page.context().pages();
                for (const p of allPages) {
                    if (p !== page) await p.close();
                }
            } catch (_) {}

            await page.waitForTimeout(2000);
        }
    }

    // Simpan ke disk hanya untuk item tanpa chatId (dari Google Form)
    if (downloadDir) {
        for (const item of processedItems) {
            if (!item.chatId) {
                let filepath = path.join(downloadDir, item.filename);

                if (fs.existsSync(filepath) && fs.statSync(filepath).size > 0) {
                    const ts   = Date.now();
                    const ext  = path.extname(item.filename);
                    const base = path.basename(item.filename, ext);
                    filepath   = path.join(downloadDir, `${base}_${ts}${ext}`);
                }

                fs.writeFileSync(filepath, item.buffer);
                item.filepath = filepath;
                console.log(`   💾 Disimpan ke disk: ${path.basename(filepath)}`);
            }
        }
    }

    console.log('\n========================================');
    console.log('📊 Hasil Fetch PDF');
    console.log(`   Berhasil : ${processedItems.length} dokumen`);
    console.log(`   Gagal    : ${queueItems.length - processedItems.length} dokumen`);
    console.log('========================================');

    return processedItems;
};
