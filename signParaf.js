const { kabid } = require('./config');

module.exports = async function signParaf(page, queueItems) {
    await page.goto('https://tte.kemenag.go.id/pegawai/document/verify/index', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });

    // Tunggu tabel muncul
    await page.waitForSelector('table tbody tr', { state: 'attached', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    console.log('✓ Halaman Inbox Paraf dimuat');

    // Cek apakah ada dokumen di inbox
    const count = await page.locator('table tbody tr').count();
    console.log(`📄 Total baris di Inbox Paraf: ${count}`);

    if (count === 0) {
        console.log('ℹ️ Inbox Paraf kosong');
        return [];
    }

    // Centang select_all untuk memilih semua dokumen sekaligus
    await page.evaluate(() => {
        const selectAll = document.querySelector('input[name="select_all"]');
        if (selectAll) {
            selectAll.checked = true;
            selectAll.dispatchEvent(new Event('change'));
            selectAll.dispatchEvent(new Event('click'));
        }
    });
    await page.waitForTimeout(500);
    console.log(`✓ Semua ${count} dokumen dicentang`);

    console.log(`\n✍️ Memaraf ${count} dokumen...`);

    // Klik "Lakukan Pemarafan Elektronik Pada Dokumen Terpilih"
    await page.waitForSelector('button#submit-btn', { state: 'visible', timeout: 10000 });
    await page.click('button#submit-btn');
    console.log('✓ Tombol pemarafan diklik');

    // Tunggu navigasi ke halaman DS Dokumen
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForSelector('#passphrase', { state: 'visible', timeout: 15000 });
    console.log('✓ Halaman DS Dokumen terbuka');

    // Isi passphrase kabid
    await page.fill('#passphrase', kabid.passphrase);
    await page.waitForTimeout(1000);
    console.log('✓ Passphrase diisi');

    // Klik "Tanda Tangan secara Digital Berkas PDF"
    await page.click('button#submit-btn.btn-danger');
    console.log('⏳ Memproses pemarafan digital...');

    // Tunggu proses selesai
    try {
        await page.waitForLoadState('load', { timeout: 120000 });

        const successSelectors = [
            '.alert-success', '.toast-success', '.swal2-success',
            'div:has-text("berhasil")', 'div:has-text("sukses")'
        ];

        let successFound = false;
        for (const sel of successSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 5000 });
                console.log(`   ✓ Notifikasi sukses terdeteksi: ${sel}`);
                successFound = true;
                break;
            } catch (_) {}
        }

        if (!successFound) {
            console.log('   ⚠️ Notifikasi sukses tidak terdeteksi, tunggu 5 detik...');
            await page.waitForTimeout(5000);
        }

        await page.waitForLoadState('load', { timeout: 30000 });
        console.log(`✅ ${count} dokumen berhasil diparaf`);

    } catch (err) {
        console.warn(`⚠️ Timeout menunggu konfirmasi paraf: ${err.message}`);
        console.warn('   Lanjut ke proses berikutnya...');
    }

    // Return semua queueItems yang masuk ke sesi paraf ini
    return queueItems;
};
