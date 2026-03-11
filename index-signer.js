const { chromium } = require('playwright');
const loginSigner = require('./loginSigner');  // ← pakai login signer
const signInbox = require('./signInbox');
const { readQueue, moveRow } = require('./sheets');

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await loginSigner(page);  // ← login sebagai penandatangan

    const queue = await readQueue('QUEUE_UPLOADED');

    for (const item of queue) {
        console.log(`✍️ Sign: ${item.nama}`);

        const signed = await signInbox(page, item);

        if (signed) {
            await moveRow('QUEUE_UPLOADED', 'QUEUE_SIGNED', item);
            console.log('✅ Moved to SIGNED');
        }
    }

    await browser.close();
})();