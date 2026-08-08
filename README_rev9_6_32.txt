Acki Radar - rev9.6.32
Tarih: 2026-07-04

DUZELTME: rev9_6_31'deki toplu ("batch") ön-kontrol denemesi calismadi -
loglarda gordugunuz gibi mainnet.ackinacki.org bu sorguyu ("accounts" root
koleksiyonu) devre disi birakmis ("Deprecated API is disabled"). Dokumantasyon
bunu destekleniyor gibi gosteriyor ama gercek sunucuda kapali. Bu revizede:

1. O batch pre-check cagrisi TAMAMEN KALDIRILDI - artik her turda bosuna
   basarisiz olacak bir istek atilmiyor, log gurultusu de bitti.

2. Bunun yerine DAHA KUCUK ama GERCEKTEN CALISAN bir optimizasyon yapildi:
   Monitor turu, her cuzdan icin eskiden 2 ayri istek atiyordu (ana hesap
   sorgusu + PopitGame sorgusu), ama ana hesap sorgusunun sonucu monitor
   tarafindan HIC KULLANILMIYORDU (sadece /info gibi komutlar kullaniyor).
   Monitor artik SADECE PopitGame sorgusunu atiyor - cuzdan basina istek
   sayisi 2'den 1'e dustu.

Bu, onceki gibi "cuzdan sayisi ne olursa olsun her turda tarama" seviyesinde
bir cozum degil (o cozum icin gercekten calisan bir batch API bulunmasi
gerekiyor, bu mainnet'te su an oyle bir sey yok), ama mevcut concurrency=1
kisitlamasiyla ayni sürede iki kat daha fazla cuzdan taranabilmesini saglar -
yani her cuzdanin ortalama tarama araligi kabaca yariya inmis olmali (8-9
dakikadan ~4-5 dakikaya), bu da "2 epoch birlesmesi" sorununu byuk olcude
azaltmali.

Bu pakette guncellenen dosyalar:
- src/bot.ts
- src/services/ackiProvider.ts

TEST ONERISI:
- Yukledikten sonra loglarda "Mining monitor batch pre-check failed" satirinin
  ARTIK GORUNMEMESI lazim (kaldirildi).
- errors: 0, rateLimited: false kalmaya devam etmeli.
- 15-20 dakika boyunca ayni cuzdanin ard arda gelen bildirimlerinin
  zaman farkina bakin - eskiden ~8-9 dakikaydi, simdi 4-6 dakika civarina
  inmesini bekliyoruz.
- Sorun cikarsa /root/backups altindaki rev9_6_31 veya rev9_6_30 yedeklerine
  donebilirsiniz.

UYGULAMA ADIMLARI:
1. Bu zip dosyasini indirin.
2. PowerShell'de:
   scp "$env:USERPROFILE\Downloads\acki_radar_rev9_6_32.zip" root@87.106.8.140:/tmp/
3. VPS'te:
   cd /var/www/acki-radar/current
   cp src/bot.ts "/root/backups/bot_before_rev9_6_32_$(date +%Y%m%d_%H%M%S).ts"
   cp src/services/ackiProvider.ts "/root/backups/ackiProvider_before_rev9_6_32_$(date +%Y%m%d_%H%M%S).ts"
   unzip -o /tmp/acki_radar_rev9_6_32.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env
4. Dogrulama:
   grep -n "getAckiPopitGameActivity" src/bot.ts src/services/ackiProvider.ts
   pm2 logs acki-radar --timestamp --lines 100
