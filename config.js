module.exports = {
    url: {
        login: 'https://tte.kemenag.go.id/login',
        inbox: 'https://tte.kemenag.go.id/pegawai/document/signature',
        done: 'https://tte.kemenag.go.id/pegawai/document/signature/done',
        download: 'https://tte.kemenag.go.id/satker/dokumen/naskah/index/unggah'
    },

    // 👤 AKUN ADMIN (untuk upload)
    admin: {
        nip: '199404052020121006@kemenag.go.id',      // ← ganti NIP admin
        password: 'SultenG321',        // ← ganti password admin
    },

    // ✍️ AKUN PENANDATANGAN
    signer: {
        nip: '197907112007011013',
        password: 'Penmad123',
        passphrase: 'Ancu_123'
    },

    pejabat: {
        kakanwil: 'H. JUNAIDIN, S.Ag, MA',
        kabag: 'MOH. TASLIM, S.Ag.,M.M',
        kabid: 'MUH. SYAMSU NURSI, S.Pd.I., MM.',
        bendahara: 'SAKINA, S.AP'
    },

    telegram: {
        token: '8717583283:AAGZxTOF6JKGYp4HJrcdhf9XqIcQ7xse-Y0',
        uploadDir: './uploads'
    }
};