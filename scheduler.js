const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const { readRows, updateStatus } = require('./sheets');
const { notifyDone, notifyError } = require('./notify');

const loginAdmin = require('./loginAdmin');
const uploadDocument = require('./uploadDocument');
const logout = require('./logout');
const loginKabid = require('./loginKabid');
const signParaf = require('./signParaf');
const loginSigner = require('./loginSigner');
const signInbox = require('./signInbox');
const downloadFinal = require('./downloadFinal');

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

let isRunning = false;

// Helper: cek apakah dokumen butuh paraf kabid
function butuhParafKabid(item) {
    const pemarafList = item.pemaraf
        ? item.pemaraf.split(',').map(p => p.trim().toLowerCase())
        : [];
    return pemarafList.includes('kabid');
}

async function runRPA() {
    if (isRunning) {
        console.log('⏳ RPA masih berjalan, skip giliran ini...');
        return;
    }

    isRunning = true;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🤖 RPA dimulai: ${new Date().toLocaleString('id-ID')}`);
    console.log('='.repeat(50));

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const queue = await readRows();
        const isValid = i => i.linkFileLocal && i.penandatangan1 && i.nama;

        const toUpload = queue.filter(i => i.status === 'READY' && i.tahun > 2025 && isValid(i));

        const invalidRows = queue.filter(i => i.status === 'READY' && i.tahun > 2025 && !isValid(i));
        if (invalidRows.length > 0) {
            console.warn(`⚠️ ${invalidRows.length} baris READY dilewati (data tidak lengkap):`);
            invalidRows.forEach(i => console.warn(`   - Baris ${i.row}: ${i.nama || '(tanpa nama)'}`));
        }

        const toParaf = queue.filter(i =>
            i.status === 'UPLOADED' && i.tahun > 2025 && butuhParafKabid(i)
        );
        const toSign = queue.filter(i =>
            (i.status === 'PARAFED' || (i.status === 'UPLOADED' && !butuhParafKabid(i))) &&
            i.tahun > 2025
        );
        const toDownload = queue.filter(i => i.status === 'SIGNED' && i.tahun > 2025);

        if (toUpload.length === 0 && toParaf.length === 0 && toSign.length === 0 && toDownload.length === 0) {
            console.log('ℹ️ Tidak ada dokumen yang perlu diproses');
            await browser.close();
            isRunning = false;
            return;
        }

        /* ========== ADMIN: UPLOAD ========== */
        if (toUpload.length > 0) {
            console.log(`\n========== UPLOAD (${toUpload.length} dokumen) ==========`);
            const adminCtx = await browser.newContext({ viewport: null, ignoreHTTPSErrors: true });
            const adminPage = await adminCtx.newPage();
            adminPage.setDefaultTimeout(60000);
            await adminPage.goto('https://tte.kemenag.go.id/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await loginAdmin(adminPage);

            for (const item of toUpload) {
                const ok = await uploadDocument(adminPage, item);
                if (ok) {
                    await updateStatus(item.row, 'UPLOADED');
                    console.log(`✅ ${item.nama} → UPLOADED`);
                } else {
                    console.warn(`⚠️ ${item.nama} → GAGAL upload`);
                    await notifyError(item.chatId, item.nama, 'Gagal pada proses upload dokumen.');
                }
            }
            await logout(adminPage);
            await adminCtx.close();
        }

        /* ========== KABID: PARAF ELEKTRONIK ========== */
        const queueAfterUpload = await readRows();
        const toParafFinal = queueAfterUpload.filter(i =>
            i.status === 'UPLOADED' && i.tahun > 2025 && butuhParafKabid(i)
        );

        if (toParafFinal.length > 0) {
            console.log(`\n========== PARAF KABID (${toParafFinal.length} dokumen) ==========`);
            const kabidCtx = await browser.newContext({ viewport: null });
            const kabidPage = await kabidCtx.newPage();
            kabidPage.setDefaultTimeout(60000);
            await loginKabid(kabidPage);

            const parafedItems = await signParaf(kabidPage, toParafFinal);
            for (const item of parafedItems) {
                await updateStatus(item.row, 'PARAFED');
                console.log(`✅ ${item.nama} → PARAFED`);
            }

            await logout(kabidPage);
            await kabidCtx.close();
            console.log('\n⏳ Menunggu server memproses paraf (5 detik)...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        /* ========== SIGNER: TTE (PARAFED + UPLOADED tanpa kabid) ========== */
        const queueAfterParaf = await readRows();
        const toSignFinal = queueAfterParaf.filter(i =>
            (i.status === 'PARAFED' || (i.status === 'UPLOADED' && !butuhParafKabid(i))) &&
            i.tahun > 2025
        );

        if (toSignFinal.length > 0) {
            console.log(`\n========== TANDA TANGAN (${toSignFinal.length} dokumen) ==========`);
            const signerCtx = await browser.newContext({ viewport: null });
            const signerPage = await signerCtx.newPage();
            signerPage.setDefaultTimeout(60000);
            await loginSigner(signerPage);

            const signedItems = await signInbox(signerPage, toSignFinal);
            for (const item of signedItems) {
                await updateStatus(item.row, 'SIGNED');
                console.log(`✅ ${item.nama} → SIGNED`);
            }

            await logout(signerPage);
            await signerCtx.close();
            console.log('\n⏳ Menunggu server memproses TTE (10 detik)...');
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        /* ========== ADMIN: DOWNLOAD ========== */
        const queueAfterSign = await readRows();
        const toDownloadFinal = queueAfterSign.filter(i => i.status === 'SIGNED' && i.tahun > 2025);

        if (toDownloadFinal.length > 0) {
            console.log(`\n========== DOWNLOAD (${toDownloadFinal.length} dokumen) ==========`);
            const dlCtx = await browser.newContext({ viewport: null });
            const dlPage = await dlCtx.newPage();
            dlPage.setDefaultTimeout(60000);
            await loginAdmin(dlPage);

            const downloadedItems = await downloadFinal(dlPage, toDownloadFinal, downloadDir);
            for (const item of downloadedItems) {
                if (item.chatId) {
                    const terkirim = await notifyDone(item.chatId, item.nama, item.buffer, item.filename);
                    if (terkirim) {
                        await updateStatus(item.row, 'SENT');
                        console.log(`✅ ${item.nama} → SENT (terkirim ke Telegram)`);
                    } else {
                        await updateStatus(item.row, 'DOWNLOADED');
                        console.log(`⚠️ ${item.nama} → DOWNLOADED (gagal kirim Telegram)`);
                    }
                } else {
                    await updateStatus(item.row, 'DOWNLOADED');
                    console.log(`✅ ${item.nama} → DOWNLOADED (disimpan ke disk)`);
                }
            }
            await dlCtx.close();
        }

    } catch (err) {
        console.error('❌ Error tidak terduga di RPA:', err.message);
    } finally {
        await browser.close();
        isRunning = false;
        console.log(`\n✅ RPA selesai: ${new Date().toLocaleString('id-ID')}`);
    }
}

console.log('⏰ Scheduler aktif — RPA akan jalan setiap 1 menit');
console.log('   Ketik Ctrl+C untuk menghentikan\n');

runRPA();
cron.schedule('*/1 * * * *', () => { runRPA(); });
