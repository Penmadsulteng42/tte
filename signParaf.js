const { kabid } = require('./config');

/**
 * Inbox paraf pegawai: https://tte.kemenag.go.id/pegawai/document/verify/index
 * Jika ada baris dengan checkbox data, centang select_all → submit → passphrase.
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

        const perRowCb = page.locator('table tbody tr input[type="checkbox"]:not([name="select_all"])');
        const nRows = await page.locator('table tbody tr').count();
        const nCheck = await perRowCb.count();

        if (nRows === 0 || nCheck === 0) {
            console.log('ℹ️ Inbox paraf kosong — tidak ada dokumen untuk diparaf (lanjut TTE)');
            return [];
        }

        console.log(`📋 Inbox paraf: ~${nCheck} checkbox data — memakai select_all`);

        const selectAll = page.locator('input[name="select_all"]');
        await selectAll.waitFor({ state: 'visible', timeout: 15000 });
        await selectAll.click({ force: true });
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

        await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});

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

        console.log(`✅ Paraf selesai — ${queueItems.length} entri queue akan ditandai PARAFED`);
        return queueItems;
    } catch (e) {
        console.error('❌ Gagal paraf:', e.message);
        return [];
    }
};
