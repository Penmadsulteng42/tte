const { chromium } = require('playwright');
const loginAdmin = require('./loginAdmin');  // ← pakai login admin
const uploadDocument = require('./uploadDocument');
const { readQueue, moveRow } = require('./sheets');

(async () => {


    const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized']
    });

    const adminContext = await browser.newContext({
        viewport: null  // ← wajib null agar mengikuti ukuran layar penuh
    });

    const page = await browser.newPage();



    await loginAdmin(page);  // ← login sebagai admin

    const queue = await readQueue('QUEUE_NEW');

    for (const item of queue) {
        console.log(`📤 Upload: ${item.nama}`);

        const success = await uploadDocument(page, item);

        if (success) {
            await moveRow('QUEUE_NEW', 'QUEUE_UPLOADED', item);
            console.log('✅ Moved to UPLOADED');
        }
    }

    await browser.close();
})();