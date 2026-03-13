const { Telegraf } = require('telegraf');
const fs = require('fs');
const { telegram } = require('./config');

const bot = new Telegraf(telegram.token);

/**
 * Kirim PDF ke Telegram langsung dari buffer (tanpa simpan ke disk)
 * @param {string} chatId   - Chat ID Telegram user
 * @param {string} nama     - Nama dokumen
 * @param {Buffer} buffer   - Buffer PDF dari memory
 * @param {string} filename - Nama file untuk Telegram
 * @returns {boolean} true jika berhasil
 */
async function notifyDone(chatId, nama, buffer, filename) {
    if (!chatId) {
        console.warn(`⚠️ Tidak ada chatId untuk dokumen: ${nama}`);
        return false;
    }

    try {
        // Kirim pesan notifikasi
        await bot.telegram.sendMessage(
            chatId,
            `✅ Dokumen TTE Selesai!\n\n📄 ${nama}\n\nBerikut file PDF yang sudah ditandatangani:`
        );

        // Kirim PDF langsung dari buffer — tidak perlu file di disk
        await bot.telegram.sendDocument(
            chatId,
            { source: buffer, filename: filename || `${nama}.pdf` },
            { caption: `📎 ${nama} - TTE Selesai` }
        );

        console.log(`📨 PDF terkirim ke chatId: ${chatId} (${(buffer.length / 1024).toFixed(1)} KB)`);
        return true;

    } catch (err) {
        console.error(`❌ Gagal kirim ke ${chatId}:`, err.message);
        return false;
    }
}

/**
 * Kirim notifikasi error ke user
 * @returns {boolean} true jika berhasil
 */
async function notifyError(chatId, nama, pesan) {
    if (!chatId) return false;

    try {
        await bot.telegram.sendMessage(
            chatId,
            `❌ Gagal memproses dokumen\n\n📄 ${nama}\n\n${pesan}\n\nSilakan hubungi admin atau coba ajukan ulang.`
        );
        return true;
    } catch (err) {
        console.error(`❌ Gagal kirim notifikasi error ke ${chatId}:`, err.message);
        return false;
    }
}

module.exports = { notifyDone, notifyError };