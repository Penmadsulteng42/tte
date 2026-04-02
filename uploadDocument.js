const fs = require('fs');
const path = require('path');
const config = require('./config.js');

module.exports = async function uploadDocument(page, item) {
    let tmpPath;
    try {
        console.log(`🚀 Menuju halaman unggah untuk: ${item.nama}`);
        await page.goto('https://tte.kemenag.go.id/satker/dokumen/naskah/create', { waitUntil: 'load', timeout: 120000 });

        // Cek session masih aktif
        if (page.url().includes('/login')) {
            throw new Error('Session expired — halaman redirect ke login');
        }
        console.log(`🌐 URL saat ini: ${page.url()}`);

        // --- 1. PROSES SELECT2 (Jenis Dokumen) ---
        await page.waitForSelector('select[name="jenis_dokumen_id"]', { timeout: 10000 });

        // Klik pada container select2 untuk membuka dropdown
        await page.click('.select2-selection--single[aria-labelledby*="jenis_dokumen_id"]');

        // Tunggu input pencarian Select2 muncul
        const searchInput = '.select2-search__field';
        await page.waitForSelector(searchInput, { state: 'visible', timeout: 5000 });

        // Clear and type pilihan
        await page.fill(searchInput, 'Dokumen Lain-Lain');

        // Tunggu hasil pencarian dan klik
        await page.waitForSelector('.select2-results__option:has-text("Dokumen Lain-Lain")', { timeout: 5000 });
        await page.click('.select2-results__option:has-text("Dokumen Lain-Lain")');
        console.log('✓ Jenis dokumen dipilih: Dokumen Lain-Lain');

        // --- 2. INPUT PERIHAL (Kolom B) ---
        await page.waitForSelector('input[name="perihal_dokumen"]', { timeout: 5000 });
        await page.fill('input[name="perihal_dokumen"]', item.nama);
        console.log(`✓ Perihal diisi: ${item.nama}`);

        // --- 3. INPUT FILE ---
        if (!item.linkFileLocal) {
            throw new Error('Link file tidak tersedia');
        }

        // Gunakan 'attached' — input file sering disembunyikan secara visual
        await page.waitForSelector('input[name="path_dokumen"]', { state: 'attached', timeout: 10000 });

        const isUrl = item.linkFileLocal.startsWith('http');

        if (isUrl) {
            // File dari Telegram — fetch ke buffer lalu simpan sementara
            console.log(`✓ Fetch file dari URL Telegram...`);
            const https = require('https');
            const os = require('os');
            tmpPath = path.join(os.tmpdir(), `tte_${Date.now()}.pdf`);

            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(tmpPath);
                https.get(item.linkFileLocal, res => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Gagal download file: HTTP ${res.statusCode}`));
                        return;
                    }
                    res.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }).on('error', reject);
            });

            if (!fs.existsSync(tmpPath)) {
                throw new Error(`File sementara gagal dibuat: ${tmpPath}`);
            }

            const fileSize = fs.statSync(tmpPath).size;
            console.log(`✓ File tersimpan sementara: ${tmpPath} (${(fileSize / 1024).toFixed(1)} KB)`);

            // Gunakan .first() untuk menghindari ambiguitas dua elemen
            await page.locator('input[name="path_dokumen"]').first().setInputFiles(tmpPath);

        } else {
            // File lokal
            if (!fs.existsSync(item.linkFileLocal)) {
                throw new Error(`File tidak ditemukan: ${item.linkFileLocal}`);
            }
            console.log(`✓ File lokal: ${item.linkFileLocal}`);
            await page.locator('input[name="path_dokumen"]').first().setInputFiles(item.linkFileLocal);
        }

        console.log('✓ File berhasil di-set ke input');

        // --- 4. SUBMIT FORM PERTAMA ---
        await page.waitForTimeout(2000);
        console.log('📤 Submit form dokumen...');

        // Klik submit dan tunggu navigasi
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
                .catch(() => page.waitForLoadState('domcontentloaded', { timeout: 60000 })),
            page.click('button[type="submit"]')
        ]);

        // Cek apakah ada pesan error dari server setelah submit
        const alertError = page.locator('.alert-danger, .alert-error');
        if (await alertError.count() > 0) {
            const errText = await alertError.first().innerText();
            throw new Error(`Server menolak form: ${errText.trim()}`);
        }

        console.log('✓ Form pertama berhasil di-submit');
        console.log(`🌐 URL setelah submit: ${page.url()}`);

        // --- 5. INPUT PEMARAF (MULTIPLE) ---
        const pemarafList = item.pemaraf ? item.pemaraf.split(',').map(p => p.trim()).filter(Boolean) : [];

        if (pemarafList.length > 0) {
            console.log(`\n🔍 Ditemukan ${pemarafList.length} pemaraf:`, pemarafList);

            for (let i = 0; i < pemarafList.length; i++) {
                const pemarafKey = pemarafList[i].toLowerCase();
                const pemarafNama = config.pejabat[pemarafKey];

                if (!pemarafNama) {
                    console.warn(`⚠️ Pejabat '${pemarafKey}' tidak ditemukan di config, dilewati`);
                    continue;
                }

                console.log(`\n📝 Menambahkan pemaraf ${i + 1}/${pemarafList.length}: ${pemarafNama}`);

                // Tunggu select2 pemaraf tersedia
                await page.waitForSelector('select[name="pegawai_id"]', { state: 'attached', timeout: 10000 });

                // Klik pada container select2 pemaraf
                await page.click('.select2-selection--single[aria-labelledby*="pegawai_id"]');

                // Tunggu input pencarian Select2 muncul
                await page.waitForSelector('.select2-search__field', { state: 'visible', timeout: 5000 });
                await page.fill('.select2-search__field', pemarafNama);

                // Tunggu hasil pencarian muncul
                await page.waitForTimeout(1500);

                await page.waitForSelector('.select2-results__option--highlighted', { timeout: 5000 });
                await page.click('.select2-results__option--highlighted');

                await page.waitForTimeout(1000);

                // Klik tombol "Tambah Pemaraf"
                await page.click('button:has-text("Tambah Pemaraf")');
                console.log(`✅ Pemaraf ditambahkan: ${pemarafNama}`);

                // Tunggu update tabel
                await page.waitForTimeout(2000);
            }
        } else {
            console.log('ℹ️ Tidak ada pemaraf, melewati langkah ini.');
        }

        // --- 6. LANJUT KE STEP PENANDATANGAN ---
        console.log('\n➡️ Lanjut ke penandatangan...');

        // Klik tombol Lanjut — coba selector teks dulu, fallback ke xpath
        const tombolLanjut = page.locator('a:has-text("Lanjut"), a:has-text("Next"), a:has-text("Selanjutnya")');
        if (await tombolLanjut.count() > 0) {
            await tombolLanjut.first().click();
        } else {
            await page.click('xpath=/html/body/section/div/section/div[2]/div/section/div[2]/a[2]');
        }

        console.log('✓ Tombol Lanjut diklik');
        await page.waitForTimeout(2000);

        // Tunggu form penandatangan muncul
        await page.waitForSelector('text=Pejabat Penandatangan', { state: 'visible', timeout: 10000 });
        console.log('✅ Step Penandatangan aktif');

        // --- 7-9. INPUT PENANDATANGAN (loop penandatangan1 s/d penandatangan4) ---
        // Data dari sheets.js menggunakan field: penandatangan1, anchor1, penandatangan2, anchor2, dst.
        const semuaPenandatangan = [
            { key: item.penandatangan1, anchorStr: item.anchor1 },
            { key: item.penandatangan2, anchorStr: item.anchor2 },
            { key: item.penandatangan3, anchorStr: item.anchor3 },
            { key: item.penandatangan4, anchorStr: item.anchor4 },
        ].filter(p => p.key && p.key.trim() !== ''); // hanya yang terisi

        if (semuaPenandatangan.length === 0) {
            throw new Error('Tidak ada penandatangan yang ditemukan di data (penandatangan1 kosong)');
        }

        console.log(`\n✍️ Total penandatangan: ${semuaPenandatangan.length}`);

        for (let pi = 0; pi < semuaPenandatangan.length; pi++) {
            const { key: penandatanganKey, anchorStr } = semuaPenandatangan[pi];
            const penandatanganNama = config.pejabat[penandatanganKey.toLowerCase()];

            if (!penandatanganNama) {
                console.warn(`⚠️ Penandatangan '${penandatanganKey}' tidak ditemukan di config, dilewati`);
                continue;
            }

            console.log(`\n✍️ [${pi + 1}/${semuaPenandatangan.length}] Memilih penandatangan: ${penandatanganNama}`);

            // Pilih penandatangan via Select2
            await page.waitForSelector('select[name="pegawai_id"]', { state: 'attached', timeout: 10000 });
            await page.click('.select2-selection--single');

            await page.waitForSelector('.select2-search__field', { state: 'visible', timeout: 5000 });
            await page.fill('.select2-search__field', penandatanganNama);
            await page.waitForTimeout(1500);

            await page.waitForSelector('.select2-results__option--highlighted', { timeout: 5000 });
            await page.click('.select2-results__option--highlighted');
            console.log(`✅ Penandatangan dipilih: ${penandatanganNama}`);

            // --- 8. PILIH ANCHOR untuk penandatangan ini ---
            const anchors = anchorStr
                ? anchorStr.split(',').map(a => a.trim()).filter(Boolean)
                : [];

            console.log(`📌 Anchor [${pi + 1}]: ${anchors.length > 0 ? anchors.join(', ') : '(tidak ada)'}`);

            if (anchors.length > 0) {
                // Tunggu select anchor tersedia
                await page.waitForSelector('select[name="anchor[]"]', { state: 'attached', timeout: 30000 });

                // Buka dropdown bootstrap-select
                const dropdownBtn = 'button[data-id="anchor"], button.dropdown-toggle';
                await page.waitForSelector(dropdownBtn, { timeout: 5000 });
                await page.click(dropdownBtn);
                console.log('✓ Dropdown anchor dibuka');

                // Tunggu dropdown list tampil
                await page.waitForSelector('.dropdown-menu.inner.show', { state: 'visible', timeout: 5000 });

                // Pilih anchor satu per satu
                for (const anchor of anchors) {
                    const clicked = await page.evaluate((anchorText) => {
                        const items = Array.from(document.querySelectorAll('.dropdown-menu.inner.show li a'));
                        const target = items.find(a => {
                            const text = a.querySelector('.text');
                            return text && text.textContent.trim() === anchorText;
                        });
                        if (target) { target.click(); return true; }
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
                await page.waitForTimeout(500);
                console.log(`✅ Semua anchor diproses: ${anchors.join(', ')}`);
            }

            // --- 9. SUBMIT PENANDATANGAN ---
            console.log(`\n📤 Submit penandatangan ${pi + 1}...`);
            await page.waitForTimeout(2000);
            await page.click('button:has-text("Tambah Penandatangan")');
            await page.waitForTimeout(2000);
            console.log(`✅ Penandatangan ${pi + 1} berhasil ditambahkan`);
        }

        console.log(`\n✅ Berhasil upload dokumen: ${item.nama}`);
        console.log(`   - Pemaraf       : ${pemarafList.length > 0 ? pemarafList.join(', ') : 'Tidak ada'}`);
        console.log(`   - Penandatangan : ${semuaPenandatangan.map(p => p.key).join(', ')}`);

        // --- 10. FINALISASI UPLOAD ---
        console.log('\n🔄 Menyelesaikan proses upload...');

        // Coba cari tombol finalisasi dengan teks dulu, fallback ke xpath
        const tombolFinal = page.locator('button:has-text("Simpan"), button:has-text("Selesai"), button:has-text("Submit"), button:has-text("Kirim")');
        if (await tombolFinal.count() > 0) {
            await tombolFinal.first().click();
        } else {
            await page.click('xpath=/html/body/section/div/section/div[1]/div/section/div[2]/form/button');
        }

        console.log('✓ Finalisasi upload selesai');
        await page.waitForTimeout(3000);

        return true;

    } catch (e) {
        console.error(`❌ Upload gagal untuk ${item.nama}:`, e.message);
        return false;
    } finally {
        // Selalu hapus file sementara
        if (tmpPath && fs.existsSync(tmpPath)) {
            try {
                fs.unlinkSync(tmpPath);
                console.log(`🗑️ File sementara dihapus: ${tmpPath}`);
            } catch (unlinkErr) {
                console.warn(`⚠️ Gagal hapus file sementara: ${tmpPath}`, unlinkErr.message);
            }
        }
    }
};