const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldProcessQueue } = require('../queueLogic');

test('memproses baris READY meski timestamp spreadsheet tidak berubah', () => {
    const queue = [
        {
            nama: 'Penyampaian KMA Pedoman Pemenuhan Beban Guru Madrasah',
            penandatangan1: 'Kabid',
            linkFileLocal: 'C:/file.pdf',
            status: 'READY',
            tahun: '2026'
        }
    ];

    assert.equal(shouldProcessQueue({ currentModified: 1000, lastModified: 1000, queue }), true);
});

test('tidak memproses jika tidak ada antrian pending dan timestamp tidak berubah', () => {
    const queue = [
        {
            nama: 'Dokumen selesai',
            penandatangan1: 'Kabid',
            linkFileLocal: 'C:/file.pdf',
            status: 'SENT',
            tahun: '2026'
        }
    ];

    assert.equal(shouldProcessQueue({ currentModified: 1000, lastModified: 1000, queue }), false);
});
