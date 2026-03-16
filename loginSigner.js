const { url, signer } = require('./config');

module.exports = async function loginSigner(page) {
    await page.goto(url.login, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 🟢 KLIK RADIO PEGAWAI (default, tapi tetap diklik untuk safety)
    await page.click('input[type="radio"][value="ASN"]'); // ← sesuaikan selector

    await page.waitForSelector('#nip', { state: 'visible' });
    await page.fill('#nip', signer.nip);
    await page.waitForSelector('#password', { state: 'visible' });
    await page.fill('#password', signer.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('load', { timeout: 60000 });

    console.log('✅ Login sebagai PENANDATANGAN berhasil');
};