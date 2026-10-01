function hasPendingQueue(queue) {
    if (!Array.isArray(queue)) return false;

    const isValid = i => i.linkFileLocal && i.penandatangan1 && i.nama;
    const antrianPerluUpload = i => (String(i.status || '').trim().toUpperCase() === '' || String(i.status || '').trim().toUpperCase() === 'READY');
    const statusUploaded = i => String(i.status || '').trim().toUpperCase() === 'UPLOADED';
    const statusParafed = i => String(i.status || '').trim().toUpperCase() === 'PARAFED';
    const statusKolomNBisaDiunduh = i => ['SIGNED', 'FINAL'].includes(String(i.status || '').trim().toUpperCase());
    const butuhParafKabid = i => {
        const pemarafText = String(i.pemaraf || '').toLowerCase().trim();
        return !!pemarafText && /\bkabid\b/.test(pemarafText);
    };
    const tahunValid = i => {
        const s = String(i.tahun || '').trim();
        const num = parseInt(s, 10);
        return !isNaN(num) && num >= 2025;
    };

    const toUpload = queue.filter(i => antrianPerluUpload(i) && tahunValid(i) && isValid(i));
    const toParaf = queue.filter(i => statusUploaded(i) && tahunValid(i) && butuhParafKabid(i));
    const toSign = queue.filter(i => (statusParafed(i) || (statusUploaded(i) && !butuhParafKabid(i))) && tahunValid(i));
    const toDownload = queue.filter(i => statusKolomNBisaDiunduh(i) && tahunValid(i));

    return toUpload.length > 0 || toParaf.length > 0 || toSign.length > 0 || toDownload.length > 0;
}

function shouldProcessQueue({ currentModified, lastModified, queue }) {
    if (!currentModified) return false;
    if (currentModified > lastModified) return true;
    return hasPendingQueue(queue);
}

module.exports = { hasPendingQueue, shouldProcessQueue };
