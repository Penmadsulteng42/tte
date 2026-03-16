const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { telegram } = require('./config');
const { appendRow } = require('./sheets');

const bot = new Telegraf(telegram.token);

// Pastikan folder upload ada
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
//  HELPER: Semua pejabat yang sudah dipilih di sesi ini
//  (pemaraf + semua penandatangan yang sudah dipilih)
// ============================================================
function sudahDipilih(s) {
    return [...s.pemaraf, ...s.penandatangan];
}

// ============================================================
//  HELPER: Keyboard pejabat dengan exclude otomatis
//  exclude = daftar key pejabat yang tidak boleh muncul lagi
// ============================================================
function keyboardPejabat(exclude = [], labelLewati = '⏭️ Tidak Ada / Lewati') {
    const semua = ['kakanwil', 'kabid', 'kabag', 'bendahara'];
    const pilihan = semua.filter(p => !exclude.includes(p));

    if (pilihan.length === 0) {
        // Semua pejabat sudah dipilih, hanya tampilkan tombol Lewati
        return Markup.inlineKeyboard([
            [Markup.button.callback(labelLewati, 'pejabat_skip')]
        ]);
    }

    return Markup.inlineKeyboard([
        pilihan.map(p => Markup.button.callback(
            p.charAt(0).toUpperCase() + p.slice(1),
            `pejabat_${p}`
        )),
        [Markup.button.callback(labelLewati, 'pejabat_skip')]
    ]);
}

// ============================================================
//  HELPER: Keyboard pemaraf (multi-select dengan centang)
// ============================================================
function keyboardPemaraf(selected = [], exclude = []) {
    const semua = ['kakanwil', 'kabid', 'kabag', 'bendahara'];
    const pilihan = semua.filter(p => !exclude.includes(p));
    return Markup.inlineKeyboard([
        pilihan.map(p => Markup.button.callback(
            selected.includes(p) ? `✅ ${p.charAt(0).toUpperCase() + p.slice(1)}` : p.charAt(0).toUpperCase() + p.slice(1),
            `pemaraf_${p}`
        )),
        [Markup.button.callback('✔️ Selesai Pilih Pemaraf', 'pemaraf_done')]
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
//  HELPER: Ringkasan (plain text untuk hindari escaping error)
// ============================================================
function formatRingkasan(s) {
    let text = `📋 Ringkasan Pengajuan TTE\n\n`;
    text += `📄 Nama Dokumen: ${s.namaDokumen}\n`;
    text += `👥 Pemaraf: ${s.pemaraf.length > 0 ? s.pemaraf.join(', ') : 'Tidak ada'}\n\n`;
    for (let i = 0; i < s.penandatangan.length; i++) {
        text += `✍️ Penandatangan ${i + 1}: ${s.penandatangan[i]}\n`;
        text += `🔑 Anchor ${i + 1}: ${s.anchor[i].join(', ')}\n\n`;
    }
    return text;
}

// ============================================================
//  HELPER: Label status yang informatif
// ============================================================
function labelStatus(status) {
    switch (status) {
        case 'UPLOADED': return '📤 Menunggu ditandatangani';
        case 'SIGNED': return '✍️ Menunggu diproses / diparaf (sedang antrian download)';
        case 'DOWNLOADED': return '✅ Selesai (tersimpan di server)';
        case 'SENT': return '✅ Selesai (terkirim ke Telegram)';
        default: return '⏳ Menunggu diproses';
    }
}

// ============================================================
//  HELPER: Download PDF dari Telegram ke lokal
// ============================================================
async function downloadFile(ctx, fileId, destPath) {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(fileLink.href, res => {
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', err => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
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

    ctx.reply('📝 Pengajuan TTE Baru\n\nLangkah 1 — Ketik nama dokumen:');
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
//  /status
// ============================================================
bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id;
    try {
        const { readRows } = require('./sheets');
        const queue = await readRows();
        const milik = queue.filter(i => i.chatId === String(chatId));

        if (milik.length === 0) {
            ctx.reply('ℹ️ Tidak ada dokumen yang diajukan.');
            return;
        }

        let text = '📊 Status Dokumen Anda:\n\n';
        milik.forEach((item, i) => {
            text += `${i + 1}. ${item.nama}\n`;
            text += `   ${labelStatus(item.status)}\n\n`;
        });

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

    // --- Nama Dokumen ---
    if (s.step === 'nama_dokumen') {
        s.namaDokumen = text.trim();
        s.step = 'pemaraf';

        ctx.reply(
            `✅ Nama: ${s.namaDokumen}\n\nLangkah 2 — Pilih pemaraf:\n(Pilih semua, lalu klik Lewati jika sudah selesai)`,
            keyboardPejabat(sudahDipilih(s))
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

    await ctx.reply('⏳ Mengunduh file...');

    const s = sessions[chatId];

    try {
        const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const filename = `${ts}_${s.namaDokumen}.pdf`;
        const filepath = path.join(telegram.uploadDir, filename);

        await downloadFile(ctx, doc.file_id, filepath);

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
            linkFileLocal: path.resolve(filepath),
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

    // --- PEMARAF ---
    if (s.step === 'pemaraf') {
        if (data === 'pejabat_skip') {
            // Lanjut ke penandatangan — exclude semua yang sudah dipilih
            s.step = 'penandatangan';
            ctx.reply(
                `✅ Pemaraf: ${s.pemaraf.length > 0 ? s.pemaraf.join(', ') : 'Tidak ada'}\n\nLangkah 3 — Pilih Penandatangan 1:`,
                keyboardPejabat(sudahDipilih(s), '⏭️ Selesai / Lanjut ke Ringkasan')
            );
        } else if (data.startsWith('pejabat_')) {
            const key = data.replace('pejabat_', '');
            if (!s.pemaraf.includes(key)) s.pemaraf.push(key);

            // Update keyboard — exclude semua yang sudah dipilih sebagai pemaraf
            ctx.reply(
                `✅ ${key} ditambahkan sebagai pemaraf.\nPilih lagi atau klik Lewati jika sudah selesai.`,
                keyboardPejabat(sudahDipilih(s))
            );
        }
        return;
    }

    // --- PENANDATANGAN ---
    if (s.step === 'penandatangan') {
        if (data === 'pejabat_skip') {
            if (s.penandatangan.length === 0) {
                ctx.reply('⚠️ Minimal harus ada 1 penandatangan!');
                return;
            }
            s.step = 'konfirmasi';
            ctx.reply(
                formatRingkasan(s) +
                '\nJika sudah benar, ketik /kirim untuk upload PDF.\nKetik /batal untuk membatalkan.'
            );
        } else if (data.startsWith('pejabat_')) {
            const key = data.replace('pejabat_', '');
            s.penandatangan.push(key);
            s.currentAnchor = [];
            s.step = 'anchor';
            ctx.reply(
                `✅ Penandatangan ${s.penandatangan.length}: ${key}\n\nLangkah 4 — Pilih anchor (boleh lebih dari satu):`,
                keyboardAnchor()
            );
        }
        return;
    }

    // --- ANCHOR ---
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
                    `✅ Anchor ${s.penandatangan.length}: ${s.anchor[s.anchor.length - 1].join(', ')}\n\nApakah ada Penandatangan ${s.penandatangan.length + 1}?`,
                    Markup.inlineKeyboard([[
                        Markup.button.callback('✅ Ya', 'tambah_ya'),
                        Markup.button.callback('❌ Tidak', 'tambah_tidak')
                    ]])
                );
            } else {
                s.step = 'konfirmasi';
                ctx.reply(
                    formatRingkasan(s) +
                    '\nJika sudah benar, ketik /kirim untuk upload PDF.\nKetik /batal untuk membatalkan.'
                );
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

    // --- TANYA TAMBAH PENANDATANGAN ---
    if (s.step === 'tanya_tambah') {
        if (data === 'tambah_ya') {
            s.step = 'penandatangan';
            // Exclude semua yang sudah dipilih (pemaraf + penandatangan sebelumnya)
            ctx.reply(
                `✍️ Pilih Penandatangan ${s.penandatangan.length + 1}:`,
                keyboardPejabat(sudahDipilih(s), '⏭️ Selesai / Lanjut ke Ringkasan')
            );
        } else if (data === 'tambah_tidak') {
            s.step = 'konfirmasi';
            ctx.reply(
                formatRingkasan(s) +
                '\nJika sudah benar, ketik /kirim untuk upload PDF.\nKetik /batal untuk membatalkan.'
            );
        }
        return;
    }
});

// ============================================================
//  Jalankan bot
// ============================================================
bot.launch();
console.log('🤖 TTE Bot aktif dan siap menerima pesan...');

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));