Acki Radar - rev9.6.38
Tarih: 2026-07-26

BU PAKETTE:
1. src/server.ts - YENI: /api/radar/wallet-count uc noktasi eklendi. Bu,
   mining-monitor.json dosyasindaki BENZERSIZ cuzdan sayisini doner. Bu,
   "Web3hunter Mining" (ayri, ilgisiz bir sistem) icin olan /api/stats'tan
   TAMAMEN FARKLI ve bagimsizdir.
2. src/bot.ts - Bu dosyada zaten (rev9_6_37'den beri) /start menusune
   "Dashboard" butonu (ackinackiradar.com'a giden) eklenmisti. Eger daha once
   hic deploy edilmediyse, bu paketle birlikte artik aktif olacak.
3. src/services/ackiProvider.ts - degisiklik yok, referans icin dahil.

Not: coming-soon sayfasi (index.html) AYRI olarak, "ackinackiradar-coming-soon.html"
adiyla verildi - o dosya /var/www/coming-soon/index.html'in uzerine
kopyalanacak, bu zip'e dahil degil.

UYGULAMA ADIMLARI (bot tarafi - server.ts + bot.ts):

1. Bu zip'i indirin, VPS'e gonderin:
   scp "C:\Users\semih\Downloads\acki_radar_rev9_6_38.zip" root@87.106.8.140:/tmp/

2. VPS'te:
   cd /var/www/acki-radar/current
   cp src/bot.ts "/root/backups/bot_before_rev9_6_38_$(date +%Y%m%d_%H%M%S).ts"
   cp src/server.ts "/root/backups/server_before_rev9_6_38_$(date +%Y%m%d_%H%M%S).ts"
   unzip -o /tmp/acki_radar_rev9_6_38.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env

3. nginx'e /api/ yolunu bot'un kendi sunucusuna (port 3000) yonlendiren YENI
   bir kural eklemeniz gerekiyor (su an / tamamen statik dosyaya gidiyor, /api/
   istekleri de oraya gidip 404 aliyor olabilir). Asagidaki adimlari izleyin
   (ayrica konusma icinde ayrintili anlatildi).

4. Test:
   curl https://ackinackiradar.com/api/radar/wallet-count
   Cikti: {"count": <sayi>, "updatedAt": "..."}  seklinde olmali.

5. Botta /start yazip Dashboard butonunun goründügünü dogrulayin.
