module.exports = async function logout(page) {
    try {
        console.log('🔓 Logout...');

        await page.goto('https://tte.kemenag.go.id/logout', {
            waitUntil: 'networkidle'
        });

        // Pastikan benar-benar logout (redirect ke login)
        await page.waitForURL(/login/, { timeout: 10000 });

        console.log('✅ Logout berhasil');
    } catch (err) {
        console.warn('⚠️ Logout gagal / sesi sudah berakhir');
    }
};
