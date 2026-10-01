# Alur Kerja Aplikasi TTE Automation

Dokumen ini menjelaskan alur kerja utama aplikasi TTE Automation dari awal pengajuan dokumen sampai hasil TTE dikirim kembali.

## 1. Input dan Pengajuan
- User mengajukan dokumen melalui Telegram Bot.
- Bot menerima data seperti nama dokumen, pemaraf, penandatangan, anchor, dan file PDF.
- File dokumen disimpan ke folder upload lokal dan data dimasukkan ke Google Spreadsheet.

## 2. Penyimpanan Data
- Data pengajuan ditulis ke Google Sheets melalui file sheets.js.
- Status dokumen dipantau melalui kolom status di spreadsheet.
- Setiap dokumen memiliki informasi penting:
  - Nama dokumen
  - Pemaraf
  - Penandatangan
  - Anchor
  - Tahun
  - Link file
  - Status
  - Chat ID Telegram

## 3. Proses Upload ke Aplikasi TTE
- Aplikasi login sebagai Admin.
- Dokumen yang berstatus READY / kosong di spreadsheet diupload ke aplikasi TTE Kemenag.
- Setelah upload berhasil, status dokumen diubah menjadi UPLOADED.

## 4. Proses Paraf Kabid
- Jika kolom pemaraf mengandung kata kabid, aplikasi login sebagai Kabid.
- Sistem membuka inbox paraf Kabid.
- Dokumen yang sesuai dicentang dan diparaf secara elektronik.
- Jika berhasil, status dokumen diubah menjadi PARAFED.

## 5. Proses TTE / Tanda Tangan Elektronik
- Setelah paraf selesai, atau jika dokumen tidak memerlukan paraf Kabid, aplikasi login sebagai Signer.
- Dokumen diproses di inbox TTE.
- Jika penandatangan hanya satu orang, status berubah menjadi SIGNED.
- Jika ada beberapa penandatangan, status bisa berubah menjadi DRAFT.

## 6. Download dan Notifikasi
- Setelah dokumen selesai diproses, aplikasi mengambil hasil final dari aplikasi TTE.
- File PDF hasil TTE didownload.
- File dikirim kembali ke pengguna melalui Telegram.
- Link hasil final juga disimpan kembali ke spreadsheet.

## 7. Alur Status Dokumen
- READY / kosong: dokumen siap diupload
- UPLOADED: dokumen berhasil diupload ke TTE
- PARAFED: dokumen berhasil diparaf Kabid
- DRAFT: dokumen sedang menunggu penandatangan lain
- SIGNED: dokumen selesai ditandatangani
- SENT / DOWNLOADED: hasil TTE sudah dikirim

## 8. Komponen Utama
- bot.js: antarmuka Telegram
- scheduler.js / run_manual.js: menjalankan alur otomatis
- uploadDocument.js: proses upload dokumen ke TTE
- signParaf.js: proses paraf Kabid
- signInbox.js: proses TTE signer
- sheets.js: membaca dan mengupdate Google Spreadsheet
- notify.js: mengirim hasil ke Telegram

## 9. Ringkasan Singkat
Alur aplikasi adalah:
1. Terima pengajuan dari Telegram
2. Simpan data ke spreadsheet
3. Upload dokumen ke TTE
4. Lakukan paraf Kabid bila diperlukan
5. Lakukan TTE signer
6. Download hasil dan kirim ke user
