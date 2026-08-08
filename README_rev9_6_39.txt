Acki Radar - rev9.6.39
Tarih: 2026-07-26

DUZELTME: /start menusundeki "Dashboard" butonu artik en USTTE goruniyor
(diger butonlarin -Wallet Info, Watch Mining, Wallets, Help- ustunde).

Bu pakette guncellenen dosya:
- src/bot.ts
(src/server.ts ve src/services/ackiProvider.ts bu revizede degismedi,
referans icin dahil edildi)

UYGULAMA ADIMLARI:
1. Bu zip dosyasini indirin.
2. PowerShell'de:
   scp "C:\Users\semih\Downloads\acki_radar_rev9_6_39.zip" root@87.106.8.140:/tmp/
3. VPS'te:
   cd /var/www/acki-radar/current
   cp src/bot.ts "/root/backups/bot_before_rev9_6_39_$(date +%Y%m%d_%H%M%S).ts"
   unzip -o /tmp/acki_radar_rev9_6_39.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env
4. Test: Botta /start yaz, Dashboard butonunun en ustte oldugunu dogrula.
