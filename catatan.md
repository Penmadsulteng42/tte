jadi sekarang kita punya 7 status

READY,
UPLOADED,
SIGNED,
DOWNLOADED,
SENT,
DRAFT,
PARAFED,

alur TTE : 
-scheduler mulai
-cek spreadsheet dengan status READY atau kosong/null yang berarti belum diproses
-jika ditemukan, maka proses TTE dimulai
-karna kita menggunakan 2 akun yaitu akun admin dan akun kabid, 
    jika ditemukan data dengan status READY atau kosong/null
        (maka sistem akan mengecek apakah kabid dipilih sebagai pemaraf atau penandatangan, 
            (jika kabid sebagai pemaraf, maka proses TTE akan dimulai dengan akun admin yaitu melakukan upload dokumen dan mengupdate status dokumen menjadi UPLOADED kemudian ke akun kabid yaitu melakukan paraf dokumen dan update status dokumen menjadi PARAFED)
            (jika kabid sebagai penandatangan tunggal/sendiri maka proses TTE akan dimulai dengan akun admin yaitu melakukan upload dokumen dan mengupdate status dokumen menjadi UPLOADED, setelah itu proses TTE akan dilanjutkan dengan akun kabid untuk melakukan tanda tangan dokumen, setelah proses TTE selesai maka status dokumen akan berubah menjadi SIGNED)
            (jika penandatangan ada lebih dari 1 maka proses TTE akan dimulai dengan akun admin yaitu melakukan upload dokumen dan mengupdate status dokumen menjadi UPLOADED, setelah itu proses TTE akan dilanjutkan dengan akun kabid untuk melakukan tanda tangan dokumen, setelah proses TTE selesai maka status dokumen akan berubah menjadi DRAFT )
            (jika proses TTE gagal karna masalah koneksi/jaringan/server maka status dokumen akan tetap menjadi READY/NULL namun jika gagalnya karna kesalahan user dalam upload data, seperti dokumen tidak valid atau salah dalam pemilihan anchor, maka statusnya akan FAILED, sehingga user harus mengupload kembali dokumen tersebut)
        )
-jika sudah selesai proses paraf maupun tandatangan maka sistem akan lanjut ke proses download/kirim ke telegram
ketika ditemukan data dengan status SIGNED dan tidak ada ada data chat id di kolom O, maka sistem akan download dan ubah status dokumen menjadi DOWNLOADED, tapi jika status SIGNED dan ada data chat id di kolom O maka akan dikirimkan ke id telegram tersebut dan update status menjadi SENT,

berikut saya simpulkan lagi berdasarkan status
READY/null : siap dilakukan proses paraf/tte
UPLOADED : sudah diupload dan siap dilakukan proses paraf/tte
SIGNED : sudah ditandatangani dan siap didownload/dikirim
DOWNLOADED : sudah didownload,proses sudah selesai, tidak akan dicek oleh sistem kita
SENT  : sudah didownload,proses sudah selesai, tidak akan dicek oleh sistem kita
DRAFT : sudah selesai ditandatangan, menunggu penandatangan lain, jika status dokumen sudah menjadi final baru bisa dilakukan download/kirim ke telegram
PARAFED : sudah selesai diparaf, menunggu penandatangan, jika status dokumen sudah menjadi final baru bisa dilakukan download/kirim ke telegram 