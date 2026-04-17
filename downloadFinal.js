const fs = require('fs');
const path = require('path');
const { url } = require('./config');
const { docKey, sanitize } = require('./utils');

/** Status di aplikasi TTE masih tahap dokumen belum final (multi penandatangan) */

function formatDownloadDate(waktu) {
    const parts = String(waktu).trim().match(/(\d{2})-(\d{2})-(\d{4})/);
    if (parts) {
        const dd = parts[1];
        const mm = parts[2];
        const yy = parts[3].slice(2);
        return `${yy}${mm}${dd}`;
    }

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(2);
    return `${yy}${mm}${dd}`;
}
function statusTTEMasihDraf(statusTd) {
    const s = (statusTd || '').toLowerCase();
    return s.includes('draf') || s.includes('draft');
}

/**
 * Cari dokumen di tabel admin semua halaman
 */
async function cariDiTabel(page, namaCari) {
    // 1. Pastikan kita berada di halaman yang benar
    const targetUrl = 'https://tte.kemenag.go.id/satker/dokumen/naskah/index/unggah';
    if (!page.url().includes('/naskah/index/unggah')) {
        await page.goto(targetUrl, { waitUntil: 'networkidle' });
    }

    try {
        console.log(`\n🔍 Memulai pencarian spesifik: "${namaCari}"`);

        // 2. Gunakan kotak pencarian (Search Box) DataTables
        // Kebanyakan web pemerintah menggunakan selector input[type="search"]
        const searchInput = page.locator('input[type="search"], .dataTables_filter input').first();
        await searchInput.fill(''); // Bersihkan pencarian sebelumnya
        await searchInput.fill(namaCari);

        // Jeda sebentar agar filter website bereaksi
        await page.waitForTimeout(2000);

        // 3. Tunggu hingga tabel selesai memuat (loading)
        // Kita menunggu indikator "No matching records" ATAU adanya baris data
        await page.waitForSelector('table tbody tr', { timeout: 30000 });

        const rows = page.locator('table tbody tr');
        const firstRowText = await rows.first().innerText();

        // 4. Cek apakah hasil pencarian kosong
        if (firstRowText.toLowerCase().includes('tidak ditemukan') ||
            firstRowText.toLowerCase().includes('no matching records')) {
            console.log(`   ⚠️ Dokumen "${namaCari}" tidak ditemukan di sistem TTE.`);
            return null;
        }

        // 5. Loop hasil pencarian (biasanya hanya 1-2 baris karena sudah difilter)
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            const row = rows.nth(i);
            const namaWeb = (await row.locator('td').nth(2).innerText()).trim();

            // Verifikasi kecocokan nama (Double check)
            if (namaWeb.toLowerCase().includes(namaCari.toLowerCase()) ||
                namaCari.toLowerCase().includes(namaWeb.toLowerCase())) {

                const waktu = (await row.locator('td').nth(1).innerText()).trim();
                const statusTd = (await row.locator('td').nth(4).innerText()).trim();
                const isSukses = statusTd.toLowerCase().includes('sukses');

                // Cek apakah tombol download FINAL sudah muncul
                const finalBtn = row.locator('a[href*="keaslian"], a[href*="signed_dokumen"], a[href*="download"]');
                const hasFinal = await finalBtn.count() > 0;

                if (isSukses && hasFinal) {
                    console.log(`   ✅ Ditemukan & Siap Unduh: "${namaWeb}"`);
                    return { waktu, nama: namaWeb, row, finalBtn: finalBtn.first() };
                } else {
                    console.log(`   ⏭️ Dokumen ditemukan tapi belum FINAL (Status: ${statusTd})`);
                    return null; // Stop pencarian karena baris sudah benar tapi status belum siap
                }
            }
        }
    } catch (err) {
        console.error(`   ❌ Gagal saat mencari "${namaCari}":`, err.message);
    }

    return null;
}

/**
 * Proses dokumen FINAL:
 * - Klik tombol FINAL → tunggu popup → ambil URL PDF dari popup
 * - Fetch PDF ke buffer memory
 * - Jika ada chatId → kirim ke Telegram (tidak simpan ke disk)
 * - Jika tidak ada chatId → simpan ke disk
 */
async function downloadFinal(page, queueItems, downloadDir) {
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
            console.log(
                `   ⏭️ '${item.nama}' tidak diunduh — tidak ada baris Sukses + FINAL di admin ` +
                `(atau belum muncul di daftar; kolom N sheet mungkin SIGNED terlalu dini)`
            );
            continue;
        }

        try {
            // Gunakan mekanisme download Playwright langsung dari klik FINAL.
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 60000 }),
                found.finalBtn.first().click()
            ]);

            // Format nama file: nama_dokumen_tanggal+nomorurut
            // tanggal: YYYYMMDD (hari proses), nomor urut: 2 digit per sesi download
            const baseName = sanitize((item.nama || found.nama || 'dokumen').replace(/\s+/g, '_'));
            const datePart = formatDownloadDate(found.waktu);
            const urutPart = String(q + 1).padStart(2, '0');
            const filename = `${baseName}_${datePart}_${urutPart}.pdf`;

            const tempPath = await download.path();
            if (!tempPath) {
                throw new Error('Playwright tidak memberikan path file unduhan');
            }

            const buffer = fs.readFileSync(tempPath);

            if (!buffer || buffer.length === 0) {
                throw new Error('Buffer PDF kosong / 0 bytes');
            }

            console.log(`   ✅ PDF berhasil: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);

            await page.waitForTimeout(2000);

            processedItems.push({
                row: item.row,
                key: docKey(found.waktu, found.nama),
                filename,
                nama: item.nama,
                chatId: item.chatId,
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
            } catch (_) { }

            await page.waitForTimeout(2000);
        }
    }

    // Simpan ke disk hanya untuk item tanpa chatId (dari Google Form)
    if (downloadDir) {
        for (const item of processedItems) {
            if (!item.chatId) {
                let filepath = path.join(downloadDir, item.filename);

                if (fs.existsSync(filepath) && fs.statSync(filepath).size > 0) {
                    const ts = Date.now();
                    const ext = path.extname(item.filename);
                    const base = path.basename(item.filename, ext);
                    filepath = path.join(downloadDir, `${base}_${ts}${ext}`);
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

module.exports = downloadFinal;
module.exports.cariDiTabel = cariDiTabel;
