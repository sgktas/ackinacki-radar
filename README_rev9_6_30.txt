Acki Radar - rev9.6.30
Tarih: 2026-07-04

Bu pakette guncellenen dosyalar:
- src/bot.ts
- src/services/ackiProvider.ts

Bu revizede yapilan degisiklikler (kronolojik):
1. Zamanlayici self-correcting hale getirildi (tur gecikmesi artik kalicilasip
   birikmez).
2. MiningHub (mininghub.ackinacki.com) veri kaynagi tamamen kaldirildi,
   sadece mainnet.ackinacki.org/graphql kullaniliyor.
3. 429 (rate limit) hatalari artik dogru tespit ediliyor, "POPIT_LOCKED_SOURCE_
   UNAVAILABLE" arkasinda gizlenmiyor.
4. /status ve saatlik otomatik ozet mesajina "TOTAL ALL WALLETS" toplam blogu
   eklendi.
5. Coklu cuzdan odul bildirimleri artik tek mesajda gruplaniyor (ayni tur
   icinde tespit edilenler icin, gecikmesiz), hizalama icin satir ici <code>
   bloklari kullaniliyor.
6. ONEMLI DUZELTME: /watch ve /unwatch komutlari ile mining monitor turu
   arasindaki yaris durumu (race condition) giderildi. Onceden, tur uzun
   surdugunde (20-40 saniye) kullanicinin o sirada yaptigi cuzdan
   ekleme/silme islemi turun eski kopyasiyla ezilip geri geliyordu. Artik
   yazma aninda diskteki guncel hal tekrar okunup sadece turun sahip oldugu
   alanlar (bakiye, son kontrol zamani vb.) uzerine ekleniyor.
7. Birden fazla cuzdanin tek bildirimde gorunmesi icin madenciligin ayni
   donemde (epoch'ta) baslatilmasi gerektigine dair bir not, /watch onay
   mesajina ve /wallets listesine eklendi.

UYGULAMA ADIMLARI:

1. Bu zip dosyasini indirin (Downloads klasorune iner).

2. Kendi bilgisayarinizda (VPS'e bagli olmayan) PowerShell'de:
   scp "$env:USERPROFILE\Downloads\acki_radar_rev9_6_30.zip" root@87.106.8.140:/tmp/

3. VPS'e baglanin:
   ssh root@87.106.8.140

4. VPS'te (once yedek alip) zip'i doogrudan proje klasorune acin:
   cd /var/www/acki-radar/current
   cp src/bot.ts /root/backups/bot_before_rev9_6_30_$(date +%Y%m%d_%H%M%S).ts
   cp src/services/ackiProvider.ts /root/backups/ackiProvider_before_rev9_6_30_$(date +%Y%m%d_%H%M%S).ts
   unzip -o /tmp/acki_radar_rev9_6_30.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env

5. Dogrulayin:
   grep -n "mergeAndWriteMiningMonitorState" src/bot.ts
   grep -n "mininghub" src/services/ackiProvider.ts   (bos donmeli)
