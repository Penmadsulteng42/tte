const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { telegram } = require('./config');
const { appendRow } = require('./sheets');

const bot = new Telegraf(telegram.token);

if (!fs.existsSync(telegram.uploadDir)) {
    fs.mkdirSync(telegram.uploadDir, { recursive: true });
}

// ============================================================
//  STATE: Sesi wizard per user (in-memory)
// ============================================================
const sessions = {};

// ============================================================
//  HELPER: Ambil nama user dari profil Telegram
// ============================================================
function getNamaUser(ctx) {
    const u = ctx.from;
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`;
    if (u.first_name) return u.first_name;
    if (u.username) return `@${u.username}`;
    return 'Pengguna';
}

// ============================================================
//  HELPER: Semua pejabat yang sudah dipilih (pemaraf + penandatangan)
// ============================================================
function sudahDipilih(s) {
    return [...s.pemaraf, ...s.penandatangan];
}

// ============================================================
//  HELPER: Progress step indicator
//  Menampilkan daftar langkah dengan tanda ✅ jika sudah selesai
//  dan ▶️ untuk langkah saat ini
// ============================================================
function formatProgress(s) {
    const steps = [];

    // Step 1: Nama Dokumen
    steps.push(s.namaDokumen
        ? `✅ 1. Nama Dokumen: ${s.namaDokumen}`
        : `▶️ 1. Nama Dokumen`
    );

    // Step 2: Pemaraf
    const pemarafSelesai = ['penandatangan', 'anchor', 'tanya_tambah', 'konfirmasi', 'tunggu_pdf'].includes(s.step);
    if (pemarafSelesai) {
        steps.push(`✅ 2. Pemaraf: ${s.pemaraf.length > 0 ? s.pemaraf.join(', ') : 'Tidak ada'}`);
    } else if (s.step === 'pemaraf') {
        steps.push(`▶️ 2. Pilih Pemaraf`);
    } else {
        steps.push(`   2. Pilih Pemaraf`);
    }

    // Step 3+: Penandatangan (dinamis tergantung jumlah)
    const penandatanganSelesai = ['konfirmasi', 'tunggu_pdf'].includes(s.step);
    if (s.penandatangan.length > 0) {
        s.penandatangan.forEach((p, i) => {
            const anchorStr = s.anchor[i] ? s.anchor[i].join(', ') : '';
            steps.push(`✅ ${3 + i * 2}. Penandatangan ${i + 1}: ${p}`);
            if (anchorStr) steps.push(`✅ ${4 + i * 2}. Anchor ${i + 1}: ${anchorStr}`);
        });
    }

    // Step saat ini (penandatangan/anchor aktif)
    if (s.step === 'penandatangan') {
        const nomor = 3 + s.penandatangan.length * 2;
        steps.push(`▶️ ${nomor}. Pilih Penandatangan ${s.penandatangan.length + 1}`);
    }
    if (s.step === 'anchor') {
        const nomor = 4 + (s.penandatangan.length - 1) * 2;
        steps.push(`▶️ ${nomor}. Pilih Anchor ${s.penandatangan.length}`);
    }

    // Step kirim PDF
    if (s.step === 'konfirmasi' || s.step === 'tunggu_pdf') {
        steps.push(`${s.step === 'tunggu_pdf' ? '▶️' : '   '} Kirim PDF`);
    }

    return steps.join('\n');
}

// ============================================================
//  HELPER: Keyboard pemaraf (multi-select, seperti anchor)
// ============================================================
function keyboardPemaraf(selected = []) {
    const semua = ['kakanwil', 'kabid', 'kabag', 'bendahara'];
    return Markup.inlineKeyboard([
        semua.map(p => Markup.button.callback(
            selected.includes(p) ? `✅ ${p.charAt(0).toUpperCase() + p.slice(1)}` : p.charAt(0).toUpperCase() + p.slice(1),
            `pemaraf_${p}`
        )),
        [Markup.button.callback('✔️ Selesai Pilih Pemaraf', 'pemaraf_done')],
        [Markup.button.callback('❌ Tidak Diparaf', 'pemaraf_none')]
    ]);
}

// ============================================================
//  HELPER: Keyboard penandatangan (single select, exclude yang sudah dipilih)
// ============================================================
function keyboardPenandatangan(exclude = []) {
    const semua = ['kakanwil', 'kabid', 'kabag', 'bendahara'];
    const pilihan = semua.filter(p => !exclude.includes(p));

    if (pilihan.length === 0) {
        return Markup.inlineKeyboard([
            [Markup.button.callback('⏭️ Selesai / Lanjut ke Ringkasan', 'penanda_skip')]
        ]);
    }

    return Markup.inlineKeyboard([
        pilihan.map(p => Markup.button.callback(
            p.charAt(0).toUpperCase() + p.slice(1),
            `penanda_${p}`
        )),
        [Markup.button.callback('⏭️ Selesai / Lanjut ke Ringkasan', 'penanda_skip')]
    ]);
}

// ============================================================
//  HELPER: Keyboard anchor
// ============================================================
function keyboardAnchor(selected = []) {
    const semua = ['*', '#', '$', '^'];
    return Markup.inlineKeyboard([
        semua.map(a => Markup.button.callback(
            selected.includes(a) ? `✅ ${a}` : a,
            `anchor_${a}`
        )),
        [Markup.button.callback('✔️ Selesai Pilih Anchor', 'anchor_done')]
    ]);
}

// ============================================================
//  HELPER: Ringkasan akhir sebelum kirim PDF
// ============================================================
function formatRingkasan(s) {
    let text = `📋 Ringkasan Pengajuan TTE\n`;
    text += `${'─'.repeat(30)}\n`;
    text += `${formatProgress(s)}\n`;
    text += `${'─'.repeat(30)}\n\n`;
    text += `Jika sudah benar, ketik /kirim untuk upload PDF.\n`;
    text += `Ketik /batal untuk membatalkan.`;
    return text;
}

// ============================================================
//  HELPER: Label status
// ============================================================
function labelStatus(status) {
    switch (status) {
        case 'UPLOADED': return '📤 Menunggu ditandatangani';
        case 'SIGNED': return '✍️  Sedang diproses';
        case 'DOWNLOADED': return '✅ Selesai (tersimpan di server)';
        case 'SENT': return '✅ Selesai (terkirim ke Telegram)';
        default: return '⏳ Pending (menunggu diproses)';
    }
}

// ============================================================
//  /start
// ============================================================
bot.start((ctx) => {
    const nama = getNamaUser(ctx);
    ctx.reply(
        `👋 Halo ${nama}!\n\n` +
        `Selamat datang di TTE Automation Bot.\n\n` +
        `📌 Perintah yang tersedia:\n` +
        `/ajukan — Ajukan dokumen TTE baru\n` +
        `/status  — Cek status dokumen Anda\n` +
        `/batal   — Batalkan pengajuan`
    );
});

// ============================================================
//  /ajukan — mulai wizard
// ============================================================
bot.command('ajukan', (ctx) => {
    const chatId = ctx.chat.id;

    sessions[chatId] = {
        step: 'nama_dokumen',
        namaDokumen: '',
        pemaraf: [],
        penandatangan: [],
        anchor: [],
        currentAnchor: [],
        namaUser: getNamaUser(ctx),
        chatId
    };

    ctx.reply(
        `📝 Pengajuan TTE Baru\n\n` +
        `▶️ 1. Nama Dokumen\n` +
        `   2. Pilih Pemaraf\n` +
        `   3. Pilih Penandatangan\n` +
        `   4. Pilih Anchor\n` +
        `   5. Kirim PDF\n\n` +
        `Ketik nama dokumen:`
    );
});

// ============================================================
//  /batal
// ============================================================
bot.command('batal', (ctx) => {
    const chatId = ctx.chat.id;
    delete sessions[chatId];
    ctx.reply('❌ Pengajuan dibatalkan.\nKetik /ajukan untuk mulai lagi.');
});

// ============================================================
//  /status — tampilkan semua dokumen milik user ini
// ============================================================
bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id;
    try {
        const { readRows } = require('./sheets');
        const queue = await readRows();
        const milik = queue.filter(i => i.chatId === String(chatId));

        if (milik.length === 0) {
            ctx.reply('ℹ️ Belum ada dokumen yang diajukan.');
            return;
        }

        let text = `📊 Status Dokumen Anda (${milik.length} dokumen)\n`;
        text += `${'─'.repeat(32)}\n\n`;

        milik.forEach((item, i) => {
            text += `${i + 1}. ${item.nama}\n`;
            text += `   ${labelStatus(item.status)}\n\n`;
        });

        const pending = milik.filter(i => !['DOWNLOADED', 'SENT'].includes(i.status)).length;
        const selesai = milik.filter(i => ['DOWNLOADED', 'SENT'].includes(i.status)).length;

        text += `${'─'.repeat(32)}\n`;
        text += `⏳ Pending : ${pending} dokumen\n`;
        text += `✅ Selesai : ${selesai} dokumen`;

        ctx.reply(text);
    } catch (err) {
        ctx.reply('❌ Gagal mengambil data. Coba lagi nanti.');
    }
});

// ============================================================
//  /kirim — user siap upload PDF
// ============================================================
bot.command('kirim', (ctx) => {
    const chatId = ctx.chat.id;

    if (!sessions[chatId]) {
        ctx.reply('⚠️ Tidak ada sesi aktif. Ketik /ajukan untuk mulai.');
        return;
    }

    if (sessions[chatId].step !== 'konfirmasi') {
        ctx.reply('⚠️ Selesaikan semua langkah terlebih dahulu.');
        return;
    }

    sessions[chatId].step = 'tunggu_pdf';
    ctx.reply('📎 Silakan kirim file PDF dokumen Anda sekarang.');
});

// ============================================================
//  HANDLER: Pesan teks
// ============================================================
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (!sessions[chatId]) return;
    if (text.startsWith('/')) return;

    const s = sessions[chatId];

    if (s.step === 'nama_dokumen') {
        s.namaDokumen = text.trim();
        s.step = 'pemaraf';

        ctx.reply(
            `${formatProgress(s)}\n\n` +
            `Pilih pemaraf (boleh lebih dari satu):\n` +
            `Klik nama untuk mencentang, lalu klik Selesai.`,
            keyboardPemaraf(s.pemaraf)
        );
    }
});

// ============================================================
//  HANDLER: File/Dokumen PDF
// ============================================================
bot.on('document', async (ctx) => {
    const chatId = ctx.chat.id;

    if (!sessions[chatId] || sessions[chatId].step !== 'tunggu_pdf') {
        ctx.reply('⚠️ Ketik /ajukan untuk memulai pengajuan terlebih dahulu.');
        return;
    }

    const doc = ctx.message.document;

    if (doc.mime_type !== 'application/pdf') {
        ctx.reply('❌ File harus berformat PDF. Coba kirim ulang.');
        return;
    }

    await ctx.reply('⏳ Memproses file...');

    const s = sessions[chatId];

    try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const fileUrl = fileLink.href;

        await appendRow({
            namaDokumen: s.namaDokumen,
            pemaraf: s.pemaraf.join(', '),
            penandatangan1: s.penandatangan[0] || '',
            anchor1: (s.anchor[0] || []).join(', '),
            penandatangan2: s.penandatangan[1] || '',
            anchor2: (s.anchor[1] || []).join(', '),
            penandatangan3: s.penandatangan[2] || '',
            anchor3: (s.anchor[2] || []).join(', '),
            penandatangan4: s.penandatangan[3] || '',
            anchor4: (s.anchor[3] || []).join(', '),
            tahun: new Date().getFullYear(),
            linkFileLocal: fileUrl,
            chatId: String(chatId)
        });

        delete sessions[chatId];

        ctx.reply(
            '✅ Dokumen berhasil diajukan!\n\n' +
            'Dokumen Anda sedang dalam antrian.\n' +
            'Hasil TTE akan dikirim otomatis ke chat ini.\n\n' +
            'Gunakan /status untuk memantau.'
        );

    } catch (err) {
        console.error('❌ Gagal simpan file:', err.message);
        ctx.reply('❌ Gagal mengunduh file. Coba kirim ulang.');
    }
});

// ============================================================
//  HANDLER: Callback tombol inline
// ============================================================
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;

    if (!sessions[chatId]) {
        await ctx.answerCbQuery();
        return;
    }

    const s = sessions[chatId];
    await ctx.answerCbQuery();

    // ── PEMARAF (multi-select) ──────────────────────────────
    if (s.step === 'pemaraf') {
        if (data === 'pemaraf_done') {
            // Selesai pilih pemaraf → lanjut ke penandatangan
            s.step = 'penandatangan';
            ctx.reply(
                `${formatProgress(s)}\n\n` +
                `Pilih Penandatangan 1:`,
                keyboardPenandatangan(sudahDipilih(s))
            );

        } else if (data === 'pemaraf_none') {
            // Tidak diparaf → set pemaraf kosong dan lanjut ke penandatangan
            s.pemaraf = [];
            s.step = 'penandatangan';
            ctx.reply(
                `${formatProgress(s)}\n\n` +
                `Pilih Penandatangan 1:`,
                keyboardPenandatangan(sudahDipilih(s))
            );

        } else if (data.startsWith('pemaraf_')) {
            const key = data.replace('pemaraf_', '');
            // Toggle: kalau sudah ada, lepas; kalau belum, tambah
            if (s.pemaraf.includes(key)) {
                s.pemaraf = s.pemaraf.filter(p => p !== key);
            } else {
                s.pemaraf.push(key);
            }
            // Update keyboard dengan centang terbaru
            ctx.editMessageReplyMarkup(keyboardPemaraf(s.pemaraf).reply_markup);
        }
        return;
    }

    // ── PENANDATANGAN (single select) ──────────────────────
    if (s.step === 'penandatangan') {
        if (data === 'penanda_skip') {
            if (s.penandatangan.length === 0) {
                ctx.reply('⚠️ Minimal harus ada 1 penandatangan!');
                return;
            }
            s.step = 'konfirmasi';
            ctx.reply(formatRingkasan(s));

        } else if (data.startsWith('penanda_')) {
            const key = data.replace('penanda_', '');
            s.penandatangan.push(key);
            s.currentAnchor = [];
            s.step = 'anchor';
            ctx.reply(
                `${formatProgress(s)}\n\n` +
                `Pilih anchor untuk ${key} (boleh lebih dari satu):`,
                keyboardAnchor()
            );
        }
        return;
    }

    // ── ANCHOR (multi-select) ───────────────────────────────
    if (s.step === 'anchor') {
        if (data === 'anchor_done') {
            if (s.currentAnchor.length === 0) {
                ctx.reply('⚠️ Pilih minimal 1 anchor!');
                return;
            }
            s.anchor.push([...s.currentAnchor]);
            s.currentAnchor = [];

            if (s.penandatangan.length < 4) {
                s.step = 'tanya_tambah';
                ctx.reply(
                    `${formatProgress(s)}\n\n` +
                    `Apakah ada Penandatangan ${s.penandatangan.length + 1}?`,
                    Markup.inlineKeyboard([[
                        Markup.button.callback('✅ Ya, tambah penandatangan', 'tambah_ya'),
                        Markup.button.callback('❌ Tidak, lanjut', 'tambah_tidak')
                    ]])
                );
            } else {
                s.step = 'konfirmasi';
                ctx.reply(formatRingkasan(s));
            }

        } else if (data.startsWith('anchor_')) {
            const anchor = data.replace('anchor_', '');
            if (s.currentAnchor.includes(anchor)) {
                s.currentAnchor = s.currentAnchor.filter(a => a !== anchor);
            } else {
                s.currentAnchor.push(anchor);
            }
            ctx.editMessageReplyMarkup(keyboardAnchor(s.currentAnchor).reply_markup);
        }
        return;
    }

    // ── TANYA TAMBAH PENANDATANGAN ──────────────────────────
    if (s.step === 'tanya_tambah') {
        if (data === 'tambah_ya') {
            s.step = 'penandatangan';
            ctx.reply(
                `${formatProgress(s)}\n\n` +
                `Pilih Penandatangan ${s.penandatangan.length + 1}:`,
                keyboardPenandatangan(sudahDipilih(s))
            );
        } else if (data === 'tambah_tidak') {
            s.step = 'konfirmasi';
            ctx.reply(formatRingkasan(s));
        }
        return;
    }
});

// ============================================================
//  Jalankan bot dengan auto-restart jika 409 conflict
// ============================================================
async function launchBot(retryCount = 0) {
    try {
        await bot.launch();
        console.log('🤖 TTE Bot aktif dan siap menerima pesan...');
    } catch (err) {
        if (err.message && err.message.includes('409')) {
            const delay = Math.min(5000 * (retryCount + 1), 30000);
            console.warn(`⚠️ Bot conflict (409) — kemungkinan ada instance lain yang berjalan.`);
            console.warn(`   Pastikan hanya satu "node app.js" yang berjalan.`);
            console.warn(`   Mencoba ulang dalam ${delay / 1000} detik... (percobaan ${retryCount + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return launchBot(retryCount + 1);
        }
        // Error lain — lempar ke atas
        throw err;
    }
}

launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
