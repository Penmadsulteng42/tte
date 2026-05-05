# Alur Aplikasi TTE Automation

Dokumen ini merangkum alur kerja dari aplikasi TTE Automation, yang mengintegrasikan Telegram Bot, Google Sheets, dan proses RPA (Robotic Process Automation) menggunakan Playwright untuk mengotomatisasi pengajuan Tanda Tangan Elektronik (TTE) di situs web TTE Kemenag.

## Arsitektur Utama

Aplikasi ini dijalankan melalui `app.js` yang secara bersamaan memuat dua komponen utama:
1. **Telegram Bot (`bot.js`)**: Antarmuka bagi pengguna untuk mengajukan dokumen TTE.
2. **RPA Scheduler (`scheduler.js`)**: Pekerja latar belakang (background worker) yang mengeksekusi otomatisasi browser untuk memproses dokumen di website TTE Kemenag.

Sebagai basis data (database) dan antrian (queue), aplikasi ini menggunakan **Google Sheets** (`sheets.js`).

---

## Alur Kerja (Workflow)

### Tahap 1: Pengajuan Dokumen via Telegram Bot
1. **Memulai Pengajuan**: Pengguna mengirim perintah `/ajukan` di Telegram. Bot memulai mode *wizard* tanya jawab.
2. **Pengisian Metadata**: Pengguna memasukkan data secara berurutan:
   - Nama Dokumen.
   - Pilihan Pemaraf (opsional, bisa lebih dari satu seperti kakanwil, kabid, dll).
   - Pilihan Penandatangan (hingga 4 penandatangan berurutan).
   - Pilihan Anchor (teks penanda posisi tanda tangan pada PDF) untuk setiap penandatangan.
3. **Upload PDF**: Setelah konfirmasi ringkasan, pengguna mengunggah file PDF.
4. **Penyimpanan Lokal & Database**:
   - Bot mengunduh file PDF ke folder Google Drive lokal (`G:\My Drive\TTE_CSV\datasources\...`).
   - Bot menambahkan baris baru ke **Google Sheets** (sheet `QUEUE_NEW`) berisi seluruh rincian pengajuan, lokasi path file lokal, dan status awal ditetapkan menjadi `READY`.

### Tahap 2: Scheduler & RPA Processing
Scheduler (`scheduler.js`) berjalan setiap 2 menit menggunakan `node-cron`. Untuk menghemat resource, scheduler hanya mengeksekusi RPA jika mendeteksi adanya perubahan modifikasi pada Google Sheets (`last_modified.json`).

Jika ada dokumen dalam antrian yang butuh diproses (filter: tahun > 2025), RPA Playwright akan menjalankan siklus berikut:

#### A. Proses Upload (Admin)
- **Kondisi**: Status di Sheet adalah `READY` (atau kosong).
- **Aksi**: Bot membuka browser, login sebagai **Admin**, mengunggah file PDF dan mengisi metadata (nama, pemaraf, penandatangan, anchor) di web TTE.
- **Hasil**: Jika sukses, status dokumen di Google Sheets diubah menjadi `UPLOADED`.

#### B. Proses Paraf (Kabid)
- **Kondisi**: Status di Sheet adalah `UPLOADED` **dan** dokumen membutuhkan paraf "Kabid".
- **Aksi**: Bot login sebagai **Kabid** (`loginKabid.js`), mencari dokumen di inbox paraf, lalu melakukan proses persetujuan paraf elektronik.
- **Hasil**: Jika sukses, status di Google Sheets diubah menjadi `PARAFED`.

#### C. Proses Tanda Tangan / TTE (Signer)
- **Kondisi**: Status di Sheet adalah `PARAFED` **ATAU** (`UPLOADED` dan tidak butuh paraf Kabid).
- **Aksi**: Bot login sebagai **Signer** (`loginSigner.js`), membuka inbox TTE, dan memproses tanda tangan elektronik menggunakan passphrase.
- **Hasil**: 
  - Jika ini adalah penandatangan terakhir, status berubah menjadi `SIGNED`.
  - Jika masih ada penandatangan lain (multi-signer), status diubah menjadi `DRAFT` hingga penandatangan berikutnya memproses.

#### D. Pengecekan Status DRAFT
Terdapat cron job terpisah setiap 2 menit yang login sebagai Admin untuk mengecek tabel dokumen. Jika dokumen yang berstatus `DRAFT`/`UPLOADED`/`PARAFED` sudah memunculkan tombol Final, status diubah menjadi `SIGNED`.

#### E. Proses Download & Notifikasi (Admin)
- **Kondisi**: Status di Sheet adalah `SIGNED`.
- **Aksi**: 
  - Bot login kembali sebagai **Admin**, mendownload file PDF final yang sudah ditandatangani.
  - Link file final diperbarui di Google Sheets.
  - File PDF hasil TTE dikirimkan kembali kepada pengusul melalui Telegram (`notify.js`).
- **Hasil**: Jika sukses terkirim ke Telegram, status berubah menjadi `SENT`. Jika hanya terdownload ke disk, statusnya `DOWNLOADED`.

---

## Rangkuman Status Dokumen
Berikut adalah pergerakan status di kolom N Google Sheets:
1. `READY`: Dokumen baru diajukan, siap di-upload.
2. `UPLOADED`: Dokumen berhasil di-upload oleh Admin.
3. `PARAFED`: Dokumen telah diparaf oleh Kabid (jika diperlukan).
4. `DRAFT`: Dokumen telah di-TTE oleh salah satu signer, menunggu signer lainnya (jika multi-signer).
5. `SIGNED`: Dokumen selesai ditandatangani oleh semua pihak dan siap diunduh.
6. `DOWNLOADED`: Dokumen berhasil diunduh ke disk server.
7. `SENT`: Dokumen final telah berhasil dikirimkan kembali ke user via Telegram.

## Keamanan dan Konfigurasi
- **Kredensial**: Login untuk masing-masing role (Admin, Kabid, Signer) dipisah di masing-masing file (`loginAdmin.js`, `loginKabid.js`, `loginSigner.js`) dan konfigurasinya mengarah pada `config.js` dan variabel environment (`.env`).
- **Google API**: Koneksi ke Spreadsheet dan Drive menggunakan file kredensial Service Account (`service-account.json` atau via variabel environment).
