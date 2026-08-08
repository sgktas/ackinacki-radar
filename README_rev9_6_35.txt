Acki Radar - rev9.6.35
Tarih: 2026-07-04

DUZELTME: Komut menusu (sol/sag alttaki "Menu" butonu) artik sohbet turune
gore farkli gosteriliyor:

- OZEL SOHBET (DM): tum komutlar goruntuleniyor (start, info, watch, unwatch,
  wallets, status, help) - hicbir sey degismedi.
- GRUP / KANAL: menude sadece "info" ve "help" goruntuleniyor.

Bu, Telegram'in kendi "command scope" ozelligiyle yapildi - yani bu sadece
gorsel menu listesi degil, ayni zamanda dogru komut/aciklama eslesmesini de
saglıyor. (Fonksiyonel kisitlama zaten rev9_6_34'te yapilmisti - o komutlar
gruptan zaten calismiyordu, bu revize sadece MENUDE de gorunmemelerini
sagliyor.)

Bu pakette guncellenen dosya:
- src/bot.ts
(src/services/ackiProvider.ts bu revizede degismedi, referans icin dahil
edildi)

UYGULAMA ADIMLARI:
1. Bu zip dosyasini indirin.
2. PowerShell'de:
   scp "$env:USERPROFILE\Downloads\acki_radar_rev9_6_35.zip" root@87.106.8.140:/tmp/
3. VPS'te:
   cd /var/www/acki-radar/current
   cp src/bot.ts "/root/backups/bot_before_rev9_6_35_$(date +%Y%m%d_%H%M%S).ts"
   unzip -o /tmp/acki_radar_rev9_6_35.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env
4. Test: Bir test grubunda botun "/" menusune tikla - sadece info ve help
   gorunmeli. Ozel sohbette ayni menuye bak - tum komutlar hala orada olmali.

NOT: Telegram bazen menu guncellemesini hemen yansitmayabilir (birkac dakika
surebilir, ya da grubu/sohbeti kapatip acmak gerekebilir).
