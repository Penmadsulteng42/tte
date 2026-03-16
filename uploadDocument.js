const fs = require('fs');
const path = require('path');
const config = require('./config.js');

module.exports = async function uploadDocument(page, item) {
    try {
        console.log(`🚀 Menuju halaman unggah untuk: ${item.nama}`);
        await page.goto('https://tte.kemenag.go.id/satker/dokumen/naskah/create', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // --- 1. PROSES SELECT2 (Jenis Dokumen) ---
        await page.waitForSelector('select[name="jenis_dokumen_id"]', { timeout: 5000 });

        // Klik pada container select2 untuk membuka dropdown
        await page.click('.select2-selection--single[aria-labelledby*="jenis_dokumen_id"]');

        // Tunggu input pencarian Select2 muncul
        const searchInput = '.select2-search__field';
        await page.waitForSelector(searchInput, { visible: true, timeout: 3000 });

        // Clear and type pilihan
        await page.fill(searchInput, 'Dokumen Lain-Lain');

        // Tunggu hasil pencarian dan klik
        await page.waitForSelector('.select2-results__option:has-text("Dokumen Lain-Lain")', { timeout: 3000 });
        await page.click('.select2-results__option:has-text("Dokumen Lain-Lain")');

        // --- 2. INPUT PERIHAL (Kolom B) ---
        await page.waitForSelector('input[name="perihal_dokumen"]', { timeout: 3000 });
        await page.fill('input[name="perihal_dokumen"]', item.nama);

        // --- 3. INPUT FILE ---
        if (!item.linkFileLocal) {
            throw new Error('Link file tidak tersedia');
        }

        const isUrl = item.linkFileLocal.startsWith('http');

        if (isUrl) {
            // File dari Telegram — fetch ke buffer lalu upload
            console.log(`✓ Fetch file dari URL Telegram...`);
            const https    = require('https');
            const os       = require('os');
            const tmpPath  = require('path').join(os.tmpdir(), `tte_${Date.now()}.pdf`);

            await new Promise((resolve, reject) => {
                const file = require('fs').createWriteStream(tmpPath);
                https.get(item.linkFileLocal, res => {
                    res.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }).on('error', reject);
            });

            console.log(`✓ File tersimpan sementara: ${tmpPath}`);
            await page.setInputFiles('input[name="path_dokumen"]', tmpPath);

            // Hapus file temp setelah upload
            require('fs').unlinkSync(tmpPath);
        } else {
            // File lokal (komputer)
            if (!require('fs').existsSync(item.linkFileLocal)) {
                throw new Error(`File tidak ditemukan: ${item.linkFileLocal}`);
            }
            console.log(`✓ File lokal: ${item.linkFileLocal}`);
            await page.setInputFiles('input[name="path_dokumen"]', item.linkFileLocal);
        }

        // --- 4. SUBMIT ---
        // Jeda 2 detik sebelum submit
        await page.waitForTimeout(2000);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
            page.click('button[type="submit"]')
        ]);

        // --- 5. INPUT PEMARAF (MULTIPLE) ---
        const pemarafList = item.pemaraf ? item.pemaraf.split(',').map(p => p.trim()) : [];

        if (pemarafList.length > 0) {

            console.log(`🔍 Ditemukan ${pemarafList.length} pemaraf:`, pemarafList);

            for (let i = 0; i < pemarafList.length; i++) {
                const pemarafKey = pemarafList[i].toLowerCase(); // 'kabid', 'kabag', dll

                // ✅ Ambil nama lengkap dari config
                const pemarafNama = config.pejabat[pemarafKey];

                if (!pemarafNama) {
                    console.warn(`⚠️ Pejabat '${pemarafKey}' tidak ditemukan di config`);
                    continue;
                }

                console.log(`\n📝 Menambahkan pemaraf ${i + 1}/${pemarafList.length}: ${pemarafNama}`);

                // Tunggu select2 pemaraf tersedia
                await page.waitForSelector('select[name="pegawai_id"]', { timeout: 5000 });

                // Klik pada container select2 pemaraf
                await page.click('.select2-selection--single[aria-labelledby*="pegawai_id"]');

                // Tunggu input pencarian Select2 muncul
                const searchPemaraf = '.select2-search__field';
                await page.waitForSelector(searchPemaraf, { visible: true, timeout: 3000 });

                // ✅ Ketik nama lengkap dari config
                await page.fill(searchPemaraf, pemarafNama);

                // Tunggu hasil pencarian muncul
                await page.waitForTimeout(1500);

                // Klik hasil pertama yang muncul
                await page.waitForSelector('.select2-results__option--highlighted', { timeout: 5000 });
                await page.click('.select2-results__option--highlighted');

                // Klik tombol "Tambah Pemaraf"
                console.log(`✅ Tambah pemaraf: ${pemarafNama}`);
                await page.waitForTimeout(1000);
                await page.click('button:has-text("Tambah Pemaraf")');

                // Tunggu update tabel
                await page.waitForTimeout(2000);
            }
        } else {
            console.log('ℹ️ Tidak ada pemaraf yang ditentukan, melewati langkah ini.');
        }



        // --- 6. LANJUT KE PENANDATANGAN ---
        console.log('\n➡️ Lanjut ke penandatangan...');


        // Klik tombol Lanjut
        await page.click('xpath=/html/body/section/div/section/div[2]/div/section/div[2]/a[2]');


        console.log('✓ Tombol Lanjut diklik');

        // Tunggu transisi wizard
        await page.waitForTimeout(2000);

        // Tunggu form penandatangan muncul
        await page.waitForSelector('text=Pejabat Penandatangan', { state: 'visible', timeout: 5000 });

        console.log('✅ Step Penandatangan aktif');

        // --- 7. INPUT PENANDATANGAN ---
        console.log(`\n✍️ Memilih penandatangan: ${item.penandatangan}`);

        const penandatanganKey = item.penandatangan.toLowerCase();
        const penandatanganNama = config.pejabat[penandatanganKey];

        if (!penandatanganNama) {
            throw new Error(`Penandatangan '${penandatanganKey}' tidak ditemukan di config`);
        }

        // Tunggu select2 penandatangan
        await page.waitForSelector('select[name="pegawai_id"]', { timeout: 5000 });
        await page.click('.select2-selection--single');

        const searchPenandatangan = '.select2-search__field';
        await page.waitForSelector(searchPenandatangan, { visible: true, timeout: 3000 });
        await page.fill(searchPenandatangan, penandatanganNama);

        await page.waitForTimeout(1500);

        await page.waitForSelector('.select2-results__option--highlighted', { timeout: 5000 });
        await page.click('.select2-results__option--highlighted');

        console.log(`✅ Penandatangan dipilih: ${penandatanganNama}`);

        // --- 8. PILIH ANCHOR ---
        console.log('\n🎯 Memilih anchor...');

        // Ambil anchor dari kolom F
        const anchorString = item.anchor || '$, #, ^, *';
        const anchors = anchorString.split(',').map(a => a.trim()).filter(Boolean);

        console.log(`📌 Anchor yang akan dipilih: ${anchors.join(', ')}`);

        // Pastikan select anchor ADA
        await page.waitForSelector('select[name="anchor[]"]', {
            state: 'attached',
            timeout: 10000
        });

        // Buka dropdown bootstrap-select
        const dropdownBtn = 'button[data-id="anchor"], button.dropdown-toggle';
        await page.waitForSelector(dropdownBtn, { timeout: 5000 });
        await page.click(dropdownBtn);

        console.log('✓ Dropdown anchor dibuka');

        // Tunggu dropdown list tampil
        await page.waitForSelector('.dropdown-menu.inner.show', {
            state: 'visible',
            timeout: 5000
        });

        // Pilih anchor satu per satu
        for (const anchor of anchors) {
            const clicked = await page.evaluate((anchorText) => {
                const items = Array.from(
                    document.querySelectorAll('.dropdown-menu.inner.show li a')
                );

                const target = items.find(a => {
                    const text = a.querySelector('.text');
                    return text && text.textContent.trim() === anchorText;
                });

                if (target) {
                    target.click();
                    return true;
                }
                return false;
            }, anchor);

            if (clicked) {
                console.log(`✓ Anchor dipilih: ${anchor}`);
                await page.waitForTimeout(400);
            } else {
                console.warn(`⚠️ Anchor '${anchor}' tidak ditemukan di dropdown`);
            }
        }

        // Tutup dropdown
        await page.keyboard.press('Escape');

        console.log(`✅ Semua anchor diproses: ${anchors.join(', ')}`);


        // --- 9. SUBMIT PENANDATANGAN ---
        console.log('\n📤 Submit penandatangan...');
        await page.waitForTimeout(2000);

        await page.click('button:has-text("Tambah Penandatangan")');

        await page.waitForTimeout(2000);

        console.log(`\n✅ Berhasil upload dokumen: ${item.nama}`);
        console.log(`   - Pemaraf: ${pemarafList.join(', ')}`);
        console.log(`   - Penandatangan: ${item.penandatangan}`);
        console.log(`   - Anchor: ${anchors.join(', ')}`);

        // --- 10. FINALISASI UPLOAD ---
        console.log('\n🔄 Menyelesaikan proses upload...');
        await page.click('xpath=/html/body/section/div/section/div[1]/div/section/div[2]/form/button');
        console.log('✓ Upload proses diselesaikan');

        // Tunggu sistem memproses data
        await page.waitForTimeout(3000);

        return true;

    } catch (e) {
        console.error(`❌ Upload gagal untuk ${item.nama}:`, e.message);
        return false;
    }


};