const { kabid } = require('./config');

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function namaCocok(namaQueue, namaWeb) {
    const q = normalizeText(namaQueue);
    const w = normalizeText(namaWeb);
    if (!q || !w) return false;
    if (q === w) return true;
    if (w.includes(q) || q.includes(w)) return true;

    const minLen = 24;
    if (q.length >= minLen && w.length >= minLen) {
        if (w.startsWith(q.slice(0, minLen)) || q.startsWith(w.slice(0, minLen))) return true;
    }

    return false;
}

/**
 * Inbox paraf pegawai: https://tte.kemenag.go.id/pegawai/document/verify/index
 * Jika pada kolom C pemaraf ada kabid/Kabid, login Kabid dan buka halaman paraf.
 * Centang semua dokumen dengan input[name="select_all"], lalu klik tombol
 * `#submit-btn` untuk "Lakukan Pemarafan Elektronik Pada Dokumen Terpilih".
 * Setelah halaman submit terbuka, masukkan passphrase dan konfirmasi seperti TTE.
 * Jika tidak ada dokumen di meja, kembalikan [] (lanjut TTE).
 *
 * @param {import('playwright').Page} page
 * @param {object[]} queueItems  Baris queue yang statusnya UPLOADED dan butuh paraf kabid (untuk update status jika sukses)
 * @returns {Promise<object[]>}  queueItems jika paraf berhasil; [] jika dilewati/gagal
 */
module.exports = async function signParaf(page, queueItems) {
    if (!queueItems || queueItems.length === 0) {
        return [];
    }

    try {
        console.log(`📌 PARAF KABID: ${queueItems.length} dokumen kandidat — ${queueItems.map(i => `${i.nama} [${i.pemaraf}]`).join('; ')}`);

        // Tambahkan delay singkat setelah login untuk memastikan sesi stabil
        await page.waitForTimeout(2000);

        await page.goto('https://tte.kemenag.go.id/pegawai/document/verify/index', {
            waitUntil: 'networkidle',
            timeout: 120000
        });

        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('tte.kemenag.go.id/login')) {
            console.log('❌ Paraf: sesi Kabid putus — bukan salah password, tapi cookie habis atau server memutus sesi sebelum buka inbox paraf');
            return [];
        }

        await page.waitForSelector('table tbody', { timeout: 30000 });

        // Tampilkan lebih banyak baris jika DataTables menyediakan pilihan per-page.
        await page.evaluate(() => {
            const select = document.querySelector('select[name="example2_length"]');
            if (select && select.value !== '100') {
                select.value = '100';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await page.waitForTimeout(1500);

        let rows = page.locator('table tbody tr');
        let nRows = await rows.count();
        let nCheck = await page.locator('table tbody tr input[type="checkbox"]:not([name="select_all"])').count();

        if (nRows === 0 || nCheck === 0) {
            console.log('ℹ️ Inbox paraf kosong atau checkbox belum muncul — tunggu 8 detik dan refresh sekali...');
            await page.waitForTimeout(8000);
            await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
            await page.waitForSelector('table tbody', { timeout: 30000 });

            rows = page.locator('table tbody tr');
            nRows = await rows.count();
            nCheck = await page.locator('table tbody tr input[type="checkbox"]:not([name="select_all"])').count();
        }

        if (nRows === 0 || nCheck === 0) {
            console.log('ℹ️ Inbox paraf kosong atau tidak ada checkbox yang tersedia — tidak ada dokumen untuk diparaf (lanjut TTE)');
            return [];
        }

        console.log(`📋 Inbox paraf: ${nRows} baris, ${nCheck} checkbox`);

        const matchedItems = [];
        for (let i = 0; i < nRows; i++) {
            const row = rows.nth(i);
            const checkbox = row.locator('input[type="checkbox"]:not([name="select_all"])').first();
            if (await checkbox.count() === 0) {
                continue;
            }

            const rowText = normalizeText(await row.innerText().catch(() => ''));
            const match = queueItems.find(item => namaCocok(item.nama, rowText));
            if (!match) {
                continue;
            }

            await checkbox.check({ force: true });
            matchedItems.push(match);
            console.log(`   ✓ Cocok paraf: ${match.nama}`);
        }

        const selectAll = page.locator('input[name="select_all"]');
        if (matchedItems.length === 0 && await selectAll.count() > 0) {
            await selectAll.waitFor({ state: 'visible', timeout: 15000 });
            await selectAll.check({ force: true });
            console.log('⚠️ Tidak ada baris yang cocok; memakai select_all sebagai fallback.');
        } else {
            if (matchedItems.length === 0) {
                console.log('⚠️ Tidak ada baris paraf yang cocok dengan queue dan select_all tidak tersedia.');
                return [];
            }
        }

        const checkedCount = await page.locator('table tbody tr input[type="checkbox"]:checked').count();
        console.log(`✳️ Checkbox tercentang: ${checkedCount}`);

        if (checkedCount === 0) {
            console.log('⚠️ Tidak ada checkbox yang berhasil dipilih — batalkan paraf.');
            return [];
        }

        await page.waitForTimeout(400);
        await page.waitForSelector('#submit-btn', { state: 'visible', timeout: 15000 });
        await page.click('#submit-btn');
        await page.waitForTimeout(800);

        await page.waitForSelector('#passphrase', { state: 'visible', timeout: 30000 });
        await page.fill('#passphrase', kabid.passphrase);
        await page.waitForTimeout(300);

        const confirmBtn = page.locator('button#submit-btn.btn-danger').first();
        if (await confirmBtn.count() > 0) {
            await confirmBtn.click();
        } else {
            await page.click('button:has-text("Tanda Tangan secara Digital Berkas PDF")');
        }

        console.log('⏳ Menunggu hasil paraf...');

        await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => { });

        const successSelectors = [
            '.alert-success',
            '.toast-success',
            '.swal2-success',
            'div:has-text("berhasil")',
            'div:has-text("sukses")'
        ];

        let ok = false;
        for (const sel of successSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 8000 });
                console.log(`   ✓ Paraf: notifikasi sukses (${sel})`);
                ok = true;
                break;
            } catch (_) { /* next */ }
        }

        if (!ok) {
            await page.waitForTimeout(2000);
            try {
                await page.goto('https://tte.kemenag.go.id/pegawai/document/verify/index', {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
                const nAfter = await page.locator('table tbody tr input[type="checkbox"]:not([name="select_all"])').count();
                if (nAfter === 0) {
                    console.log('   ✓ Paraf: inbox data kosong setelah proses');
                    ok = true;
                }
            } catch (_) { /* abaikan */ }
        }

        if (!ok) {
            console.log('   ⚠️ Paraf: tidak ada konfirmasi sukses jelas — status queue tidak diubah');
            return [];
        }

        const resultItems = matchedItems.length > 0 ? matchedItems : queueItems;
        console.log(`✅ Paraf selesai — ${resultItems.length} entri queue akan ditandai PARAFED`);
        return resultItems;
    } catch (e) {
        console.error('❌ Gagal paraf:', e.message);
        return [];
    }
};
