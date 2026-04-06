const { url, kabid } = require('./config');

module.exports = async function loginKabid(page) {
    await page.goto(url.login, { waitUntil: 'load', timeout: 120000 });

    await page.click('input[type="radio"][value="ASN"]');

    await page.waitForSelector('#nip', { state: 'visible' });
    await page.fill('#nip', kabid.nip);
    await page.waitForSelector('#password', { state: 'visible' });
    await page.fill('#password', kabid.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('load', { timeout: 120000 });

    console.log('✅ Login sebagai KABID berhasil');
};
