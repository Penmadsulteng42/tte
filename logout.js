module.exports = async function logout(page) {
    console.log('🔓 Logout...');

    try {
        // Klik dropdown user/avatar di pojok kanan atas
        const dropdownSelectors = [
            'a[href*="logout"]',
            'button[href*="logout"]',
            '.dropdown-toggle',
            'a.nav-link.dropdown-toggle',
            '#navbarDropdown',
        ];

        // Coba cari link logout langsung
        let logoutLink = null;
        for (const sel of dropdownSelectors) {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
                // Jika ini dropdown, klik dulu untuk expand
                const href = await el.getAttribute('href').catch(() => '');
                if (href && href.includes('logout')) {
                    logoutLink = el;
                    break;
                }
                // Klik dropdown untuk tampilkan menu
                await el.click();
                await page.waitForTimeout(500);
                break;
            }
        }

        // Setelah dropdown terbuka, cari link logout di menu
        if (!logoutLink) {
            const menuLogout = page.locator([
                'a[href*="logout"]',
                'a:has-text("Logout")',
                'a:has-text("Keluar")',
                'a:has-text("Sign Out")',
            ].join(', ')).first();

            if (await menuLogout.count() > 0) {
                logoutLink = menuLogout;
            }
        }

        if (logoutLink) {
            await logoutLink.click();
            await page.waitForLoadState('load', { timeout: 60000 });
            console.log('✅ Logout berhasil');
        } else {
            // Fallback: tutup browser context saja
            console.log('⚠️ Tombol logout tidak ditemukan, menutup sesi...');
        }

    } catch (err) {
        console.warn('⚠️ Logout gagal:', err.message);
    }
};
