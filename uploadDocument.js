const fs = require('fs');
const config = require('./config.js');

/*
 * HELPER: Pilih penandatangan via Select2
 */
async function pilihPenandatangan(page, nama) {
    await page.waitForSelector('select[name="pegawai_id"]', { timeout: 5000 });
    await page.click('.select2-selection--single');

    await page.waitForSelector('.select2-search__field', { visible: true, timeout: 3000 });
    await page.fill('.select2-search__field', nama);
    await page.waitForTimeout(1500);

    await page.waitForSelector('.select2-results__option--highlighted', { timeout: 5000 });
    await page.click('.select2-results__option--highlighted');

    console.log(`      ✓ Dipilih: ${nama}`);
}

/*
 * HELPER: Pilih anchor (bisa multiple) via bootstrap-select
 * anchorString contoh: "*, #" atau "$" atau "*, #, $, ^"
 */
async function pilihAnchor(page, anchorString) {
    const anchors = anchorString.split(',').map(a => a.trim()).filter(Boolean);
    if (anchors.length === 0) {
        console.warn('      ⚠️ Anchor kosong, dilewati');
        return;
    }

    console.log(`      📌 Anchor: ${anchors.join(', ')}`);

    await page.waitForSelector('select[name="anchor[]"]', { state: 'attached', timeout: 10000 });

    const dropdownBtn = 'button[data-id="anchor"], button.dropdown-toggle';
    await page.waitForSelector(dropdownBtn, { timeout: 5000 });
    await page.click(dropdownBtn);

    await page.waitForSelector('.dropdown-menu.inner.show', { state: 'visible', timeout: 5000 });

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
            console.log(`      ✓ Anchor dipilih: ${anchor}`);
            await page.waitForTimeout(400);
        } else {
            console.warn(`      ⚠️ Anchor '${anchor}' tidak ditemukan`);
        }
    }

    await page.keyboard.press('Escape');
}

/*
 * MAIN: Upload 1 dokumen lengkap dengan pemaraf + 4 penandatangan
 */
module.exports = async function uploadDocument(page, item) {
    try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`📄 Upload: ${item.nama}`);
        console.log('='.repeat(50));

        await page.goto('https://tte.kemenag.go.id/satker/dokumen/naskah/create', { waitUntil: 'networkidle' });

        // -------------------------------------------------------
        // 1. JENIS DOKUMEN
        // -------------------------------------------------------
        await page.waitForSelector('select[name="jenis_dokumen_id"]', { timeout: 5000 });
        await page.click('.select2-selection--single[aria-labelledby*="jenis_dokumen_id"]');
        await page.waitForSelector('.select2-search__field', { visible: true, timeout: 3000 });
        await page.fill('.select2-search__field', 'Dokumen Lain-Lain');
        await page.waitForSelector('.select2-results__option:has-text("Dokumen Lain-Lain")', { timeout: 3000 });
        await page.click('.select2-results__option:has-text("Dokumen Lain-Lain")');
        console.log('✓ Jenis dokumen: Dokumen Lain-Lain');

        // -------------------------------------------------------
        // 2. PERIHAL
        // -------------------------------------------------------
        await page.waitForSelector('input[name="perihal_dokumen"]', { timeout: 3000 });
        await page.fill('input[name="perihal_dokumen"]', item.nama);
        console.log(`✓ Perihal: ${item.nama}`);

        // -------------------------------------------------------
        // 3. FILE PDF
        // -------------------------------------------------------
        if (!item.linkFileLocal) {
            throw new Error('Link file lokal tidak tersedia');
        }
        if (!fs.existsSync(item.linkFileLocal)) {
            throw new Error(`File tidak ditemukan: ${item.linkFileLocal}`);
        }
        await page.setInputFiles('input[name="path_dokumen"]', item.linkFileLocal);
        console.log(`✓ File: ${item.linkFileLocal}`);

        // -------------------------------------------------------
        // 4. SUBMIT FORM AWAL
        // -------------------------------------------------------
        await page.waitForTimeout(2000);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"]')
        ]);
        console.log('✓ Form awal disubmit');

        // -------------------------------------------------------
        // 5. PEMARAF (MULTIPLE, opsional)
        // -------------------------------------------------------
        const pemarafList = item.pemaraf
            ? item.pemaraf.split(',').map(p => p.trim()).filter(Boolean)
            : [];

        if (pemarafList.length > 0) {
            console.log(`\n📝 Pemaraf (${pemarafList.length}): ${pemarafList.join(', ')}`);

            for (let i = 0; i < pemarafList.length; i++) {
                const key = pemarafList[i].toLowerCase();
                const nama = config.pejabat[key];

                if (!nama) {
                    console.warn(`   ⚠️ '${key}' tidak ada di config, dilewati`);
                    continue;
                }

                console.log(`   [${i + 1}/${pemarafList.length}] ${nama}`);

                await page.waitForSelector('select[name="pegawai_id"]', { timeout: 5000 });
                await page.click('.select2-selection--single[aria-labelledby*="pegawai_id"]');
                await page.waitForSelector('.select2-search__field', { visible: true, timeout: 3000 });
                await page.fill('.select2-search__field', nama);
                await page.waitForTimeout(1500);
                await page.waitForSelector('.select2-results__option--highlighted', { timeout: 5000 });
                await page.click('.select2-results__option--highlighted');

                await page.waitForTimeout(1000);
                await page.click('button:has-text("Tambah Pemaraf")');
                await page.waitForTimeout(2000);
                console.log(`   ✅ Pemaraf ditambahkan: ${nama}`);
            }
        } else {
            console.log('ℹ️ Tidak ada pemaraf, dilewati');
        }

        // -------------------------------------------------------
        // 6. LANJUT KE STEP PENANDATANGAN
        // -------------------------------------------------------
        console.log('\n➡️ Pindah ke step penandatangan...');
        await page.click('xpath=/html/body/section/div/section/div[2]/div/section/div[2]/a[2]');
        await page.waitForTimeout(2000);
        await page.waitForSelector('text=Pejabat Penandatangan', { state: 'visible', timeout: 5000 });
        console.log('✓ Step penandatangan aktif');

        // -------------------------------------------------------
        // 7. LOOP 4 PENANDATANGAN
        // -------------------------------------------------------
        const penandatanganList = [
            { key: item.penandatangan1, anchor: item.anchor1 },
            { key: item.penandatangan2, anchor: item.anchor2 },
            { key: item.penandatangan3, anchor: item.anchor3 },
            { key: item.penandatangan4, anchor: item.anchor4 },
        ].filter(p => p.key && p.key.trim() !== '');

        if (penandatanganList.length === 0) {
            throw new Error('Minimal 1 penandatangan harus diisi');
        }

        console.log(`\n✍️ Total penandatangan: ${penandatanganList.length}`);

        for (let i = 0; i < penandatanganList.length; i++) {
            const { key, anchor } = penandatanganList[i];
            const nama = config.pejabat[key.toLowerCase()];

            if (!nama) {
                console.warn(`   ⚠️ '${key}' tidak ada di config, dilewati`);
                continue;
            }

            console.log(`\n   [${i + 1}/${penandatanganList.length}] ${nama}`);

            // Pilih penandatangan
            await pilihPenandatangan(page, nama);

            // Pilih anchor
            if (anchor && anchor.trim()) {
                await pilihAnchor(page, anchor);
            } else {
                console.warn(`      ⚠️ Anchor penandatangan ${i + 1} kosong`);
            }

            // Klik Tambah Penandatangan
            await page.waitForTimeout(2000);
            await page.click('button:has-text("Tambah Penandatangan")');
            await page.waitForTimeout(2000);
            console.log(`   ✅ Penandatangan ${i + 1} ditambahkan`);
        }

        // -------------------------------------------------------
        // 8. FINALISASI
        // -------------------------------------------------------
        console.log('\n🔄 Finalisasi upload...');
        await page.click('xpath=/html/body/section/div/section/div[1]/div/section/div[2]/form/button');
        await page.waitForTimeout(3000);

        // Ringkasan
        console.log(`\n✅ Upload selesai: ${item.nama}`);
        console.log(`   Pemaraf: ${pemarafList.join(', ') || '-'}`);
        penandatanganList.forEach((p, i) => {
            const nama = config.pejabat[p.key.toLowerCase()] || p.key;
            console.log(`   Penandatangan ${i + 1}: ${nama} | Anchor: ${p.anchor || '-'}`);
        });

        return true;

    } catch (err) {
        console.error(`\n❌ Upload gagal [${item.nama}]: ${err.message}`);
        return false;
    }
};