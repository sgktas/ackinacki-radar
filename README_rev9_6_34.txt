Acki Radar - rev9.6.34
Tarih: 2026-07-04

DUZELTME (rev9_6_33'un devami): Grup/kanal kisitlamasi netlestirildi.

Artik grup/kanal sohbetlerinde:
- /info ve /wallet (ayni komutun diger adi) CALISIYOR
- /help CALISIYOR
- DIGER TUM KOMUTLAR icin bot SESSIZ KALIYOR (hicbir yanit vermiyor, eskisi
  gibi "sadece ozel mesajda calisir" mesaji bile atmiyor)

Ozel (private) sohbetlerde hicbir sey degismedi, tum komutlar normal calisiyor.

Bu pakette guncellenen dosya:
- src/bot.ts
(src/services/ackiProvider.ts bu revizede degismedi, referans icin dahil
edildi)

UYGULAMA ADIMLARI:
1. Bu zip dosyasini indirin.
2. PowerShell'de:
   scp "$env:USERPROFILE\Downloads\acki_radar_rev9_6_34.zip" root@87.106.8.140:/tmp/
3. VPS'te:
   cd /var/www/acki-radar/current
   cp src/bot.ts "/root/backups/bot_before_rev9_6_34_$(date +%Y%m%d_%H%M%S).ts"
   unzip -o /tmp/acki_radar_rev9_6_34.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env
4. Test: bir test grubunda /info walletadi dene (calismali), /watch veya
   baska bir komut dene (bot hic yanit vermemeli).
