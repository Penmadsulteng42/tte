const { url, kabid } = require('./config');

module.exports = async function loginKabid(page) {
    console.log('🔐 Memulai login Kabid...');
    await page.goto(url.login, { waitUntil: 'load', timeout: 120000 });
    console.log('📄 Halaman login dimuat');

    const radioSelector = 'input[type="radio"][value="ASN"]';
    if (await page.locator(radioSelector).count() > 0) {
        await page.click(radioSelector);
        console.log('👤 Pilih ASN');
    } else {
        console.log('⚠️ Radio ASN tidak ditemukan — lanjut tanpa memilih radio');
    }

    await page.waitForSelector('#nip', { state: 'visible' });
    await page.fill('#nip', kabid.nip);
    console.log('📝 NIP diisi');

    await page.waitForSelector('#password', { state: 'visible' });
    await page.fill('#password', kabid.password);
    console.log('🔑 Password diisi');

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 120000 }).catch(() => null),
        page.click('button[type="submit"]')
    ]);
    console.log('🚀 Klik submit dan menunggu respons login');

    const currentUrl = page.url();
    console.log('🌐 URL saat ini:', currentUrl);

    const stillOnLogin = currentUrl.includes('/login') || currentUrl.includes('tte.kemenag.go.id/login');
    const errorMessages = await page.locator('.alert-danger, .alert-error, .text-danger, .invalid-feedback, .help-block').allInnerTexts().catch(() => []);

    if (stillOnLogin) {
        console.log('❌ Login Kabid gagal — tampilan masih di halaman login');
        if (errorMessages.length > 0) {
            console.log('   ⚠️ Pesan error login:', errorMessages.join(' | '));
        }
        await page.screenshot({ path: 'kabid_login_failure.png' });
        console.log('📸 Screenshot disimpan: kabid_login_failure.png');
        throw new Error(`Login Kabid gagal${errorMessages.length > 0 ? ': ' + errorMessages.join(' | ') : ''}`);
    }

    // Pastikan login berhasil dengan menunggu elemen dashboard
    try {
        await page.waitForSelector('.dashboard, .navbar, #sidebar, .content, .card, h1, h2', { timeout: 30000 });
        console.log('✅ Login sebagai KABID berhasil — dashboard terdeteksi');
    } catch (e) {
        console.log('⚠️ Login KABID: dashboard tidak terdeteksi, tapi lanjut...');
        await page.screenshot({ path: 'kabid_login_debug.png' });
        console.log('📸 Screenshot disimpan: kabid_login_debug.png');
    }
};
