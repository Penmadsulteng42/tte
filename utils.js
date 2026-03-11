module.exports = {
    docKey(waktu, nama) {
        return `${waktu}__${nama}`;
    },

    safeFilename(waktu, nama) {
        const w = waktu
            .replace(/,/g, '')
            .replace(/pukul\s*/i, '')
            .replace(/\s+/g, '_')
            .replace(/:/g, '-');

        const n = nama.replace(/[\\/:*?"<>|]/g, '');
        return `${w}_${n}.pdf`;
    }
};
