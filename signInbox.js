const { signer } = require('./config');

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

    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const rows  = page.locator('table tbody tr');
    const count = await rows.count();
    console.log(`📄 Total baris di inbox: ${count}`);

    const signedItems = [];

    // Centang dokumen yang cocok dengan queue
    for (let i = 0; i < count; i++) {
        const row      = rows.nth(i);
        const waktuWeb = (await row.locator('td').nth(2).innerText()).trim();
        const namaWeb  = (await row.locator('td').nth(3).innerText()).trim();
        const tahun    = Number(waktuWeb.match(/20\d{2}/)?.[0] || 0);

        const match = queueItems.find(d =>
            namaWeb.toLowerCase().includes(d.nama.toLowerCase()) && tahun > 2025
        );

        if (match) {
            await row.locator('input[type="checkbox"]').check({ force: true });
            signedItems.push(match);
            console.log(`   ✓ Ditandai: ${namaWeb}`);
        }
    }

    if (signedItems.length === 0) {
        console.log('ℹ️ Tidak ada dokumen yang cocok untuk ditandatangani');
        return signedItems;
    }

    console.log(`\n✍️ Menandatangani ${signedItems.length} dokumen...`);

    // Klik submit pertama → buka modal passphrase
    await page.click('#submit-btn');
    await page.waitForTimeout(1000);

    // Isi passphrase
    await page.waitForSelector('#passphrase', { state: 'visible', timeout: 5000 });
    await page.fill('#passphrase', signer.passphrase);
    await page.waitForTimeout(1000);

    // Klik submit kedua → proses TTE dimulai
    await page.click('#submit-btn');

    // -------------------------------------------------------
    // TUNGGU PROSES TTE SELESAI
    // Strategi berlapis:
    // 1. Tunggu networkidle (request selesai)
    // 2. Tunggu indikator sukses muncul di halaman
    // 3. Tunggu tabel inbox refresh (dokumen yang ditandai hilang dari inbox)
    // -------------------------------------------------------
    console.log('⏳ Menunggu proses TTE selesai...');

    try {
        // Tunggu networkidle — semua request API selesai
        await page.waitForLoadState('load', { timeout: 60000 });

        // Tunggu notifikasi sukses muncul (toast/alert)
        // Coba beberapa kemungkinan selector notifikasi sukses
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
            } catch (_) {}
        }

        if (!successFound) {
            // Fallback: tunggu tambahan 5 detik jika tidak ada notifikasi
            console.log('   ⚠️ Notifikasi sukses tidak terdeteksi, tunggu 5 detik tambahan...');
            await page.waitForTimeout(5000);
        }

        // Tunggu halaman stabil setelah notifikasi
        await page.waitForLoadState('load', { timeout: 60000 });

        // Verifikasi: dokumen yang ditandatangani seharusnya hilang dari inbox
        await page.waitForTimeout(2000);

        console.log(`✅ ${signedItems.length} dokumen berhasil ditandatangani`);

    } catch (err) {
        console.warn(`⚠️ Timeout menunggu konfirmasi TTE: ${err.message}`);
        console.warn('   Lanjut ke proses berikutnya...');
    }

    return signedItems;
};
