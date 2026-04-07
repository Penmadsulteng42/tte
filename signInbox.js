const { signer } = require('./config');

/** Normalisasi untuk perbandingan nama (perihal) inbox vs queue */
function normalizeNama(s) {
    return (s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Cocokkan nama dokumen di inbox dengan nama di sheet.
 * Situs bisa memotong teks; queue bisa lebih panjang — cukup salah satu mengandung yang lain.
 */
function namaCocok(namaQueue, namaWeb) {
    const q = normalizeNama(namaQueue);
    const w = normalizeNama(namaWeb);
    if (!q || !w) return false;
    if (q === w) return true;
    if (w.includes(q) || q.includes(w)) return true;
    // Potongan panjang: bandingkan minimal 24 karakter pertama jika keduanya cukup panjang
    const minLen = 24;
    if (q.length >= minLen && w.length >= minLen) {
        if (w.startsWith(q.slice(0, minLen)) || q.startsWith(w.slice(0, minLen))) return true;
    }
    return false;
}

module.exports = async function signInbox(page, queueItems) {
    await page.goto('https://tte.kemenag.go.id/pegawai/document/signature/index', {
        waitUntil: 'networkidle'
    });
    await page.waitForSelector('table tbody tr');

    // -------------------------------------------------------
    // UBAH RECORDS PER PAGE ke 100 via JavaScript
    // -------------------------------------------------------
    await page.evaluate(() => {
        const select = document.querySelector('select[name="example2_length"]');
        if (select) {
            select.value = '100';
            select.dispatchEvent(new Event('change'));
        }
    });
    await page.waitForTimeout(1500);
    console.log('✓ Records per page diset ke 100');

    await page.waitForSelector('table tbody tr', { timeout: 120000 });

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    console.log(`📄 Total baris di inbox: ${count}`);

    const signedItems = [];

    // Centang dokumen yang cocok dengan queue
    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const waktuWeb = (await row.locator('td').nth(2).innerText()).trim();
        const namaWeb = (await row.locator('td').nth(3).innerText()).trim();
        // Tahun dari teks kolom waktu (bisa kosong jika format tanggal tanpa tahun)
        const tahunDariWeb = Number(waktuWeb.match(/20\d{2}/)?.[0] || 0);

        const match = queueItems.find(d => {
            if (!d.nama || !namaCocok(d.nama, namaWeb)) return false;
            // Utamakan tahun di sheet; fallback tahun di kolom web (jika ada)
            const tahunOk = d.tahun > 2025 || tahunDariWeb > 2025;
            return tahunOk;
        });

        if (match) {
            await row.locator('input[type="checkbox"]').check({ force: true });
            signedItems.push(match);
            console.log(`   ✓ Ditandai: ${namaWeb}`);
        }
    }

    if (signedItems.length === 0) {
        console.log('ℹ️ Tidak ada dokumen yang cocok untuk ditandatangani');
        if (count > 0 && queueItems.length > 0) {
            const sample = Math.min(5, count);
            console.log('   Debug — contoh baris inbox vs nama di queue:');
            for (let j = 0; j < sample; j++) {
                const r = rows.nth(j);
                const t2 = (await r.locator('td').nth(2).innerText()).trim().slice(0, 80);
                const t3 = (await r.locator('td').nth(3).innerText()).trim().slice(0, 120);
                console.log(`     [${j + 1}] waktu="${t2}" | perihal="${t3}"`);
            }
            console.log('   Nama di queue (sample):', queueItems.slice(0, 5).map(d => d.nama).join(' | '));
        }
        return signedItems;
    }

    console.log(`\n✍️ Menandatangani ${signedItems.length} dokumen...`);

    // Klik submit pertama → buka modal passphrase
    await page.waitForSelector('#submit-btn', { state: 'visible', timeout: 15000 });
    await page.click('#submit-btn');
    await page.waitForTimeout(1000);

    // Isi passphrase
    await page.waitForSelector('#passphrase', { state: 'visible', timeout: 10000 });
    await page.fill('#passphrase', signer.passphrase);
    await page.waitForTimeout(500);

    // Klik submit kedua → proses TTE dimulai
    const tla = page.locator('button#submit-btn.btn-danger').first();
    if (await tla.count() > 0) {
        await tla.click();
    } else {
        await page.click('button:has-text("Tanda Tangan secara Digital Berkas PDF")');
    }
    console.log('⏳ Proses TTE dimulai, menunggu konfirmasi...');

    try {
        const initialRowCount = await page.locator('table tbody tr').count();

        await page.waitForLoadState('networkidle', { timeout: 120000 });

        const successSelectors = [
            '.alert-success',
            '.toast-success',
            '.swal2-success',
            'div:has-text("berhasil")',
            'div:has-text("sukses")',
            '.notification-success'
        ];

        let successFound = false;
        for (const sel of successSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 5000 });
                console.log(`   ✓ Notifikasi sukses terdeteksi: ${sel}`);
                successFound = true;
                break;
            } catch (_) { }
        }

        const rowCountChanged = await page.waitForFunction((count) => {
            const rows = document.querySelectorAll('table tbody tr');
            return rows.length < count;
        }, initialRowCount, { timeout: 120000 }).catch(() => false);

        if (!successFound && !rowCountChanged) {
            console.log('   ⚠️ Tidak ada notifikasi sukses dan jumlah baris belum berkurang, tunggu 5 detik tambahan...');
            await page.waitForTimeout(5000);
        }

        if (rowCountChanged) {
            console.log('   ✓ Jumlah baris inbox berkurang setelah TTE');
        }

        if (!successFound && !rowCountChanged) {
            console.log('   ⚠️ Proses TTE mungkin tidak selesai; lanjut ke langkah berikutnya');
        }

        console.log(`✅ ${signedItems.length} dokumen diproses untuk TTE`);

    } catch (err) {
        console.warn(`⚠️ Timeout menunggu konfirmasi TTE: ${err.message}`);
        console.warn('   Lanjut ke proses berikutnya...');
    }

    return signedItems;
};
