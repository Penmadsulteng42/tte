module.exports = async function logout(page) {
    console.log('🔓 Logout...');

    try {
        // Cek dulu apakah page masih bisa diakses
        await page.evaluate(() => true);
    } catch {
        console.warn('⚠️ Halaman sudah tertutup, skip logout.');
        return;
    }

    try {
        // Strategi 1: submit form#logout-form langsung via JS (paling cepat)
        const formAda = await page.evaluate(() => {
            const form = document.getElementById('logout-form');
            if (form) { form.submit(); return true; }
            return false;
        });

        if (formAda) {
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
            console.log('✅ Logout berhasil');
            return;
        }

        // Strategi 2: buka dropdown #userbox dulu, baru submit via JS
        const dropdown = page.locator('#userbox a[data-toggle="dropdown"]').first();
        if (await dropdown.count() > 0) {
            await dropdown.click();
            await page.waitForTimeout(500);
        }

        // Klik via JS agar tidak perlu elemen visible
        const clicked = await page.evaluate(() => {
            const form = document.getElementById('logout-form');
            if (form) { form.submit(); return true; }

            const link = document.querySelector('a[href*="logout"]');
            if (link) { link.click(); return true; }

            return false;
        });

        if (clicked) {
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
            console.log('✅ Logout berhasil');
        } else {
            console.warn('⚠️ Tombol logout tidak ditemukan, menutup sesi...');
        }

    } catch (err) {
        if (err.message.includes('closed') || err.message.includes('Target page')) {
            console.warn('⚠️ Sesi sudah tertutup saat logout, diabaikan.');
        } else {
            console.warn('⚠️ Logout gagal:', err.message);
        }
    }
};