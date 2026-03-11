const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { telegram } = require('./config');
const { appendRow } = require('./sheets');

const bot = new TelegramBot(telegram.token, { polling: true });

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
function getNamaUser(msg) {
    const u = msg.from;
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`;
    if (u.first_name) return u.first_name;
    if (u.username) return `@${u.username}`;
    return 'Pengguna';
}

// ============================================================
//  HELPER: Keyboard pejabat
// ============================================================
function keyboardPejabat(exclude = []) {
    const semua = ['kakanwil', 'kabid', 'kabag', 'bendahara'];
    const pilihan = semua.filter(p => !exclude.includes(p));
    return {
        inline_keyboard: [
            pilihan.map(p => ({
                text: p.charAt(0).toUpperCase() + p.slice(1),
                callback_data: `pejabat_${p}`
            })),
            [{ text: '⏭️ Tidak Ada / Lewati', callback_data: 'pejabat_skip' }]
        ]
    };
}

// ============================================================
//  HELPER: Keyboard anchor
// ============================================================
function keyboardAnchor(selected = []) {
    const semua = ['*', '#', '$', '^'];
    return {
        inline_keyboard: [
            semua.map(a => ({
                text: selected.includes(a) ? `✅ ${a}` : a,
                callback_data: `anchor_${a}`
            })),
            [{ text: '✔️ Selesai Pilih Anchor', callback_data: 'anchor_done' }]
        ]
    };
}

// ============================================================
//  HELPER: Ringkasan sebelum upload
// ============================================================
function formatRingkasan(s) {
    let text = `📋 *Ringkasan Pengajuan TTE*\n\n`;
    text += `📄 *Nama Dokumen:* ${s.namaDokumen}\n`;
    text += `👥 *Pemaraf:* ${s.pemaraf.length > 0 ? s.pemaraf.join(', ') : 'Tidak ada'}\n\n`;
    for (let i = 0; i < s.penandatangan.length; i++) {
        text += `✍️ *Penandatangan ${i + 1}:* ${s.penandatangan[i]}\n`;
        text += `🔑 *Anchor ${i + 1}:* ${s.anchor[i].join(', ')}\n\n`;
    }
    return text;
}

// ============================================================
//  HELPER: Download PDF dari Telegram ke lokal
// ============================================================
async function downloadFile(fileId, destPath) {
    const fileInfo = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${telegram.token}/${fileInfo.file_path}`;

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(fileUrl, res => {
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
bot.onText(/\/start/, (msg) => {
    const nama = getNamaUser(msg);
    bot.sendMessage(msg.chat.id,
        `👋 Halo *${nama}*!\n\n` +
        `Selamat datang di *TTE Automation Bot*.\n\n` +
        `📌 Perintah yang tersedia:\n` +
        `/ajukan — Ajukan dokumen TTE baru\n` +
        `/status  — Cek status dokumen Anda\n` +
        `/batal   — Batalkan pengajuan`,
        { parse_mode: 'Markdown' }
    );
});

// ============================================================
//  /ajukan — mulai wizard
// ============================================================
bot.onText(/\/ajukan/, (msg) => {
    const chatId = msg.chat.id;

    sessions[chatId] = {
        step: 'nama_dokumen',
        namaDokumen: '',
        pemaraf: [],
        penandatangan: [],
        anchor: [],
        currentAnchor: [],
        namaUser: getNamaUser(msg),
        chatId
    };

    bot.sendMessage(chatId,
        `📝 *Pengajuan TTE Baru*\n\nLangkah 1 — Ketik *nama dokumen*:`,
        { parse_mode: 'Markdown' }
    );
});

// ============================================================
//  /batal
// ============================================================
bot.onText(/\/batal/, (msg) => {
    const chatId = msg.chat.id;
    delete sessions[chatId];
    bot.sendMessage(chatId, '❌ Pengajuan dibatalkan.\nKetik /ajukan untuk mulai lagi.');
});

// ============================================================
//  /status
// ============================================================
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const { readRows } = require('./sheets');
        const queue = await readRows();
        const milik = queue.filter(i => i.chatId === String(chatId));

        if (milik.length === 0) {
            bot.sendMessage(chatId, 'ℹ️ Tidak ada dokumen yang diajukan.');
            return;
        }

        let text = '📊 *Status Dokumen Anda:*\n\n';
        milik.forEach((item, i) => {
            const status = item.status || 'Menunggu';
            const emoji = status === 'DOWNLOADED' ? '✅' :
                status === 'SIGNED' ? '✍️' :
                    status === 'UPLOADED' ? '📤' : '⏳';
            text += `${i + 1}. ${emoji} *${item.nama}*\n   Status: ${status}\n\n`;
        });

        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
        bot.sendMessage(chatId, '❌ Gagal mengambil data. Coba lagi nanti.');
    }
});

// ============================================================
//  /kirim — user siap upload PDF
// ============================================================
bot.onText(/\/kirim/, (msg) => {
    const chatId = msg.chat.id;

    if (!sessions[chatId]) {
        bot.sendMessage(chatId, '⚠️ Tidak ada sesi aktif. Ketik /ajukan untuk mulai.');
        return;
    }

    if (sessions[chatId].step !== 'konfirmasi') {
        bot.sendMessage(chatId, '⚠️ Selesaikan semua langkah terlebih dahulu.');
        return;
    }

    sessions[chatId].step = 'tunggu_pdf';
    bot.sendMessage(chatId,
        '📎 Silakan kirim *file PDF* dokumen Anda sekarang.',
        { parse_mode: 'Markdown' }
    );
});

// ============================================================
//  HANDLER: Pesan teks
// ============================================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!sessions[chatId]) return;
    if (text && text.startsWith('/')) return;

    const s = sessions[chatId];

    // --- Nama Dokumen ---
    if (s.step === 'nama_dokumen' && text) {
        s.namaDokumen = text.trim();
        s.step = 'pemaraf';

        bot.sendMessage(chatId,
            `✅ Nama: *${s.namaDokumen}*\n\nLangkah 2 — Pilih *pemaraf*:\n_(Pilih semua pemaraf, lalu klik Lewati jika sudah)_`,
            { parse_mode: 'Markdown', reply_markup: keyboardPejabat() }
        );
        return;
    }

    // --- Tunggu PDF ---
    if (s.step === 'tunggu_pdf') {
        if (msg.document) {
            if (msg.document.mime_type !== 'application/pdf') {
                bot.sendMessage(chatId, '❌ File harus berformat *PDF*. Coba kirim ulang.', { parse_mode: 'Markdown' });
                return;
            }

            await bot.sendMessage(chatId, '⏳ Mengunduh file...');

            try {
                const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
                const filename = `${ts}_${s.namaDokumen}.pdf`;
                const filepath = path.join(telegram.uploadDir, filename);

                await downloadFile(msg.document.file_id, filepath);

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

                bot.sendMessage(chatId,
                    '✅ *Dokumen berhasil diajukan!*\n\n' +
                    'Dokumen Anda sedang dalam antrian untuk diproses.\n' +
                    'Hasil TTE akan dikirim otomatis ke chat ini.\n\n' +
                    'Gunakan /status untuk memantau.',
                    { parse_mode: 'Markdown' }
                );

            } catch (err) {
                console.error('❌ Gagal simpan file:', err.message);
                bot.sendMessage(chatId, '❌ Gagal mengunduh file. Coba kirim ulang.');
            }

        } else {
            bot.sendMessage(chatId, '⚠️ Harap kirim file *PDF*, bukan teks atau file lain.', { parse_mode: 'Markdown' });
        }
    }
});

// ============================================================
//  HANDLER: Callback tombol inline
// ============================================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (!sessions[chatId]) return;
    const s = sessions[chatId];
    await bot.answerCallbackQuery(query.id);

    // --- PEMARAF ---
    if (s.step === 'pemaraf') {
        if (data === 'pejabat_skip') {
            s.step = 'penandatangan';
            bot.sendMessage(chatId,
                `✅ Pemaraf: *${s.pemaraf.length > 0 ? s.pemaraf.join(', ') : 'Tidak ada'}*\n\nLangkah 3 — Pilih *Penandatangan 1*:`,
                { parse_mode: 'Markdown', reply_markup: keyboardPejabat(s.pemaraf) }
            );
        } else if (data.startsWith('pejabat_')) {
            const key = data.replace('pejabat_', '');
            if (!s.pemaraf.includes(key)) s.pemaraf.push(key);
            bot.sendMessage(chatId,
                `✅ *${key}* ditambahkan sebagai pemaraf.\nPilih lagi atau klik Lewati jika sudah selesai.`,
                { parse_mode: 'Markdown', reply_markup: keyboardPejabat() }
            );
        }
        return;
    }

    // --- PENANDATANGAN ---
    if (s.step === 'penandatangan') {
        if (data === 'pejabat_skip') {
            if (s.penandatangan.length === 0) {
                bot.sendMessage(chatId, '⚠️ Minimal harus ada 1 penandatangan!');
                return;
            }
            s.step = 'konfirmasi';
            bot.sendMessage(chatId,
                formatRingkasan(s) +
                '\nJika sudah benar, ketik /kirim untuk upload PDF.\nKetik /batal untuk membatalkan.',
                { parse_mode: 'Markdown' }
            );
        } else if (data.startsWith('pejabat_')) {
            const key = data.replace('pejabat_', '');
            s.penandatangan.push(key);
            s.currentAnchor = [];
            s.step = 'anchor';
            bot.sendMessage(chatId,
                `✅ Penandatangan ${s.penandatangan.length}: *${key}*\n\nLangkah 4 — Pilih *anchor* (boleh lebih dari satu):`,
                { parse_mode: 'Markdown', reply_markup: keyboardAnchor() }
            );
        }
        return;
    }

    // --- ANCHOR ---
    if (s.step === 'anchor') {
        if (data === 'anchor_done') {
            if (s.currentAnchor.length === 0) {
                bot.sendMessage(chatId, '⚠️ Pilih minimal 1 anchor!');
                return;
            }
            s.anchor.push([...s.currentAnchor]);
            s.currentAnchor = [];

            if (s.penandatangan.length < 4) {
                s.step = 'tanya_tambah';
                bot.sendMessage(chatId,
                    `✅ Anchor ${s.penandatangan.length}: *${s.anchor[s.anchor.length - 1].join(', ')}*\n\nApakah ada *Penandatangan ${s.penandatangan.length + 1}*?`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✅ Ya', callback_data: 'tambah_ya' },
                                { text: '❌ Tidak', callback_data: 'tambah_tidak' }
                            ]]
                        }
                    }
                );
            } else {
                s.step = 'konfirmasi';
                bot.sendMessage(chatId,
                    formatRingkasan(s) +
                    '\nJika sudah benar, ketik /kirim untuk upload PDF.\nKetik /batal untuk membatalkan.',
                    { parse_mode: 'Markdown' }
                );
            }
        } else if (data.startsWith('anchor_')) {
            const anchor = data.replace('anchor_', '');
            if (s.currentAnchor.includes(anchor)) {
                s.currentAnchor = s.currentAnchor.filter(a => a !== anchor);
            } else {
                s.currentAnchor.push(anchor);
            }
            bot.editMessageReplyMarkup(
                keyboardAnchor(s.currentAnchor),
                { chat_id: chatId, message_id: query.message.message_id }
            );
        }
        return;
    }

    // --- TANYA TAMBAH PENANDATANGAN ---
    if (s.step === 'tanya_tambah') {
        if (data === 'tambah_ya') {
            s.step = 'penandatangan';
            bot.sendMessage(chatId,
                `✍️ Pilih *Penandatangan ${s.penandatangan.length + 1}*:`,
                { parse_mode: 'Markdown', reply_markup: keyboardPejabat(s.pemaraf) }
            );
        } else if (data === 'tambah_tidak') {
            s.step = 'konfirmasi';
            bot.sendMessage(chatId,
                formatRingkasan(s) +
                '\nJika sudah benar, ketik /kirim untuk upload PDF.\nKetik /batal untuk membatalkan.',
                { parse_mode: 'Markdown' }
            );
        }
        return;
    }
});

console.log('🤖 TTE Bot aktif dan siap menerima pesan...');