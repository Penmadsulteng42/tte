const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const { telegram } = require('./config');

const bot = new TelegramBot(telegram.token);

/**
 * Kirim notifikasi + file PDF hasil TTE ke user
 * @param {string} chatId   - Chat ID Telegram user
 * @param {string} nama     - Nama dokumen
 * @param {string} filepath - Path file PDF hasil download
 */
async function notifyDone(chatId, nama, filepath) {
    if (!chatId) {
        console.warn(`⚠️ Tidak ada chatId untuk dokumen: ${nama}`);
        return;
    }

    try {
        // Kirim pesan notifikasi
        await bot.sendMessage(
            chatId,
            `✅ *Dokumen TTE Selesai!*\n\n📄 *${nama}*\n\nBerikut file PDF yang sudah ditandatangani:`,
            { parse_mode: 'Markdown' }
        );

        // Kirim file PDF
        if (filepath && fs.existsSync(filepath)) {
            await bot.sendDocument(chatId, filepath, {
                caption: `📎 ${nama} — TTE Selesai`
            });
            console.log(`📨 Notifikasi + PDF terkirim ke chatId: ${chatId}`);
        } else {
            await bot.sendMessage(chatId, '⚠️ File PDF tidak ditemukan, silakan download manual.');
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
        await bot.sendMessage(
            chatId,
            `❌ *Gagal memproses dokumen*\n\n📄 *${nama}*\n\n${pesan}\n\nSilakan hubungi admin atau coba ajukan ulang.`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error(`❌ Gagal kirim notifikasi error ke ${chatId}:`, err.message);
    }
}

module.exports = { notifyDone, notifyError };