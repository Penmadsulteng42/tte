module.exports = async function signDocument(page, item) {
    try {
        await page.goto('https://tte.kemenag.go.id/pegawai/document/signature/index');
        await page.waitForSelector('text=' + item.nama, { timeout: 5000 });
        await page.click(`text=${item.nama}`);
        await page.click('#sign');

        await page.waitForTimeout(2000);
        return true;
    } catch (e) {
        console.error('❌ Gagal tanda tangan', e.message);
        return false;
    }
};
