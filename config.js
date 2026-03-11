require('dotenv').config();

module.exports = {
    url: {
        login: 'https://tte.kemenag.go.id/login',
        inbox: 'https://tte.kemenag.go.id/pegawai/document/signature',
        done: 'https://tte.kemenag.go.id/pegawai/document/signature/done',
        download: 'https://tte.kemenag.go.id/satker/dokumen/naskah/index/unggah'
    },

    admin: {
        nip: process.env.ADMIN_NIP,
        password: process.env.ADMIN_PASSWORD,
    },
    signer: {
        nip: process.env.SIGNER_NIP,
        password: process.env.SIGNER_PASSWORD,
        passphrase: process.env.SIGNER_PASSPHRASE
    },


    pejabat: {
        kakanwil: 'H. JUNAIDIN, S.Ag, MA',
        kabag: 'MOH. TASLIM, S.Ag.,M.M',
        kabid: 'MUH. SYAMSU NURSI, S.Pd.I., MM.',
        bendahara: 'SAKINA, S.AP'
    },

    telegram: {
        token: process.env.TELEGRAM_TOKEN,
        uploadDir: './uploads'
    },
};