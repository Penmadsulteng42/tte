const { url, admin } = require('./config');

module.exports = async function loginAdmin(page) {
    await page.goto(url.login, { waitUntil: 'load', timeout: 120000 });

    // 🔴 KLIK RADIO ADMIN
    await page.click('input[type="radio"][value="ADMIN"]'); // ← sesuaikan selector

    await page.fill('#email', admin.nip);
    await page.fill('#password', admin.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('load', { timeout: 120000 });

    console.log('✅ Login sebagai ADMIN berhasil');
};