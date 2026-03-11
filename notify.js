const { Telegraf } = require('telegraf');
const fs = require('fs');
const { telegram } = require('./config');

const bot = new Telegraf(telegram.token);

/**
 * Kirim notifikasi + file PDF hasil TTE ke user
 */
async function notifyDone(chatId, nama, filepath) {
    if (!chatId) {
        console.warn(`⚠️ Tidak ada chatId untuk dokumen: ${nama}`);
        return;
    }

    try {
        await bot.telegram.sendMessage(
            chatId,
            `✅ *Dokumen TTE Selesai\\!*\n\n📄 *${nama}*\n\nBerikut file PDF yang sudah ditandatangani:`,
            { parse_mode: 'MarkdownV2' }
        );

        if (filepath && fs.existsSync(filepath)) {
            await bot.telegram.sendDocument(chatId, { source: filepath }, {
                caption: `📎 ${nama} — TTE Selesai`
            });
            console.log(`📨 Notifikasi + PDF terkirim ke chatId: ${chatId}`);
        } else {
            await bot.telegram.sendMessage(chatId, '⚠️ File PDF tidak ditemukan, silakan download manual.');
            console.warn(`⚠️ File tidak ditemukan: ${filepath}`);
        }

    } catch (err) {
        console.error(`❌ Gagal kirim notifikasi ke ${chatId}:`, err.message);
    }
}

/**
 * Kirim notifikasi error ke user
 */
async function notifyError(chatId, nama, pesan) {
    if (!chatId) return;

    try {
        await bot.telegram.sendMessage(
            chatId,
            `❌ *Gagal memproses dokumen*\n\n📄 *${nama}*\n\n${pesan}\n\nSilakan hubungi admin atau coba ajukan ulang\\.`,
            { parse_mode: 'MarkdownV2' }
        );
    } catch (err) {
        console.error(`❌ Gagal kirim notifikasi error ke ${chatId}:`, err.message);
    }
}

module.exports = { notifyDone, notifyError };