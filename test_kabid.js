const { chromium } = require('playwright');
const loginKabid = require('./loginKabid');

async function testLoginKabid() {
    const browser = await chromium.launch({ headless: false }); // headless false untuk melihat
    const page = await browser.newPage();

    try {
        await loginKabid(page);
        console.log('✅ Test login Kabid berhasil');
    } catch (e) {
        console.error('❌ Test login Kabid gagal:', e.message);
    } finally {
        await browser.close();
    }
}

testLoginKabid();