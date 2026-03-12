const { Telegraf } = require('telegraf');
const fs = require('fs');
const { telegram } = require('./config');

const bot = new Telegraf(telegram.token);

// Escape karakter khusus HTML agar aman dipakai di parse_mode: HTML
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Kirim notifikasi + file PDF hasil TTE ke user
 * @returns {boolean} true jika berhasil, false jika gagal
 */
async function notifyDone(chatId, nama, filepath) {
    if (!chatId) {
        console.warn(`⚠️ Tidak ada chatId untuk dokumen: ${nama}`);
        return false;
    }

    const namaEsc = escHtml(nama);

    try {
        await bot.telegram.sendMessage(
            chatId,
            `✅ <b>Dokumen TTE Selesai!</b>\n\n📄 <b>${namaEsc}</b>\n\nBerikut file PDF yang sudah ditandatangani:`,
            { parse_mode: 'HTML' }
        );

        if (filepath && fs.existsSync(filepath)) {
            await bot.telegram.sendDocument(
                chatId,
                { source: filepath },
                {
                    caption: `📎 ${namaEsc} — TTE Selesai`,
                    parse_mode: 'HTML'
                }
            );
            console.log(`📨 Notifikasi + PDF terkirim ke chatId: ${chatId}`);
        } else {
            await bot.telegram.sendMessage(
                chatId,
                '⚠️ File PDF tidak ditemukan di server, silakan hubungi admin.'
            );
            console.warn(`⚠️ File tidak ditemukan: ${filepath}`);
        }

        return true;

    } catch (err) {
        console.error(`❌ Gagal kirim notifikasi ke ${chatId}:`, err.message);
        return false;
    }
}

/**
 * Kirim notifikasi error ke user
 * @returns {boolean} true jika berhasil, false jika gagal
 */
async function notifyError(chatId, nama, pesan) {
    if (!chatId) return false;

    const namaEsc = escHtml(nama);
    const pesanEsc = escHtml(pesan);

    try {
        await bot.telegram.sendMessage(
            chatId,
            `❌ <b>Gagal memproses dokumen</b>\n\n📄 <b>${namaEsc}</b>\n\n${pesanEsc}\n\nSilakan hubungi admin atau coba ajukan ulang.`,
            { parse_mode: 'HTML' }
        );
        return true;
    } catch (err) {
        console.error(`❌ Gagal kirim notifikasi error ke ${chatId}:`, err.message);
        return false;
    }
}

module.exports = { notifyDone, notifyError };