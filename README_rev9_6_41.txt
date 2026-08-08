Acki Radar - rev9.6.41
Tarih: 2026-07-26

EKLEME: Yeni admin komutu /broadcast_all <mesaj>

Botun zaten var olan data/users.json kaydini kullaniyor (her /start bunu
otomatik dolduruyor - registerOrGetUser). Yani /broadcast_all, botu en az
bir kez /start ile baslatmis HERKESE ulasir - sadece cuzdan izleyenlere
degil, hic cuzdan izlememis olanlara da.

Iki komut arasindaki fark:
- /broadcast <mesaj>     -> sadece en az 1 cuzdan izleyenler (mining-monitor.json)
- /broadcast_all <mesaj> -> botu hic kullanmis HERKES (data/users.json)

Ikisi de: mesaja bir link (orn. https://ackinackiradar.com) eklersen,
Telegram otomatik onizleme karti gosterir (logo + baslik + aciklama) -
ayrica fotograf gondermenize gerek yok.

Bu pakette guncellenen dosya:
- src/bot.ts
(src/server.ts ve src/services/ackiProvider.ts bu revizede degismedi,
referans icin dahil edildi)

UYGULAMA ADIMLARI:
1. Bu zip dosyasini indirin.
2. PowerShell'de:
   scp "C:\Users\semih\Downloads\acki_radar_rev9_6_41.zip" root@87.106.8.140:/tmp/
3. VPS'te:
   cd /var/www/acki-radar/current
   cp src/bot.ts "/root/backups/bot_before_rev9_6_41_$(date +%Y%m%d_%H%M%S).ts"
   unzip -o /tmp/acki_radar_rev9_6_41.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env
4. Test: /broadcast_all test mesaji yazin, kendi hesabiniza mesajin geldigini
   dogrulayin (siz de data/users.json icinde kayitlisinizdir, /start
   yaptiginiz icin).
