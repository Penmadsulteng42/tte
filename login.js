const { url, credential } = require('./config');

module.exports = async function login(page) {
    await page.goto(url.login, { waitUntil: 'networkidle' });
    await page.fill('#nip', credential.nip);
    await page.fill('#password', credential.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('✅ Login berhasil');
};
