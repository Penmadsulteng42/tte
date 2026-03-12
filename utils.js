/**
 * Bersihkan nama file dari karakter yang tidak valid di Windows/Linux
 */
function sanitize(str) {
    return String(str)
        .replace(/[\\/:*?"<>|]/g, '')  // karakter tidak valid di Windows
        .replace(/\s+/g, ' ')           // multiple spasi jadi satu
        .trim();
}

/**
 * Generate nama file dari waktu dan nama dokumen
 * Format: NamaDokumen_DDMMYYHHMMSS.pdf
 *
 * Contoh:
 *   waktu  = "11-03-2026"
 *   nama   = "Permohonan Data T.A 2025"
 *   result = "Permohonan Data T.A 2025_120326000000.pdf"
 *
 * @param {string} waktu  - Tanggal dari tabel web, format "DD-MM-YYYY"
 * @param {string} nama   - Nama dokumen
 */
function safeFilename(waktu, nama) {
    let stamp = '';

    try {
        // Coba parse waktu dari format "DD-MM-YYYY" atau "DD-MM-YYYY HH:MM:SS"
        const parts = String(waktu).trim().match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);

        if (parts) {
            const dd = parts[1];
            const mm = parts[2];
            const yy = parts[3].slice(2); // ambil 2 digit tahun
            const hh = parts[4] || '00';
            const mi = parts[5] || '00';
            const ss = parts[6] || '00';
            stamp = `${dd}${mm}${yy}${hh}${mi}${ss}`;
        } else {
            // Fallback: pakai waktu sekarang
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yy = String(now.getFullYear()).slice(2);
            const hh = String(now.getHours()).padStart(2, '0');
            const mi = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            stamp = `${dd}${mm}${yy}${hh}${mi}${ss}`;
        }
    } catch (_) {
        stamp = String(Date.now());
    }

    const namaBersih = sanitize(nama);
    return `${namaBersih}_${stamp}.pdf`;
}

/**
 * Generate key unik untuk identifikasi dokumen
 */
function docKey(waktu, nama) {
    return `${sanitize(waktu)}_${sanitize(nama)}`.toLowerCase().replace(/\s+/g, '_');
}

module.exports = { safeFilename, docKey, sanitize };