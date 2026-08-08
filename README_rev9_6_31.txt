Acki Radar - rev9.6.31
Tarih: 2026-07-04

ONEMLI: Bu revizyon, taramanin CEKIRDEK secim mantigini degistiriyor.
Dikkatli test edin, sorun cikarsa kolayca eski rev'e (rev9_6_30) donebilirsiniz.

Bu pakette guncellenen dosyalar:
- src/bot.ts
- src/services/ackiProvider.ts

SORUN: Cuzdan sayisi arttikca (90+), her cuzdan icin ayri ayri sorgu atmak
mainnet.ackinacki.org'un rate limitine takiliyordu. Bu yuzden concurrency=1'e
dusurmek zorunda kalmistik, ki bu da her cuzdanin gercekte ~8-9 dakikada bir
taranmasi anlamina geliyordu (5 dakikalik epoch'tan daha seyrek). Sonuc: bazi
bildirimler 2 epoch'un toplamini tek seferde gosteriyordu (yanlis degil, ama
istenmeyen bir davranis).

COZUM: mainnet.ackinacki.org GraphQL API'si resmi dokumantasyonuna gore
"accounts(filter:{id:{in:[...]}})" ile BIRDEN FAZLA hesabi TEK istekte
sorgulamaya izin veriyor (sadece balance/last_paid/last_trans_lt donuyor,
kilitli NACKL'yi cozmek icin gereken ham veri/BOC bu toplu sorguda gelmiyor).

Yeni akis:
1. Her turda, TUM izlenen cuzdanlarin PopitGame adresleri icin TEK (ya da
   birkaç parcali) toplu sorgu atiliyor - bu ucuz bir "bir sey degisti mi"
   kontrolu (last_trans_lt karsilastirmasi).
2. Sadece GERCEKTEN degismis olan cuzdanlar, mevcut (pahali, detayli, kilitli
   NACKL'yi cozen) tekli sorguya yonlendiriliyor - rotasyon sirasi ne olursa
   olsun, o tur icinde ONCELIKLI olarak taraniyor.
3. Degismemis cuzdanlar hic pahali sorguya gitmiyor, boylece toplam istek
   sayisi cuzdan sayisiyla degil, GERCEK DEGISIKLIK sayisiyla olculuyor.
4. Toplu kontrol basarisiz olursa (ag hatasi vb.), sistem otomatik olarak
   ESKI rotasyon davranisina geri donuyor - yani bu degisiklik hicbir riski
   ARTIRMIYOR, sadece normal calistiginda cok daha hizli/olcek.lenebilir
   hale getiriyor.

Bu sayede cuzdan sayisi artmaya devam etse bile (rate limit'e takilmadan),
her cuzdan pratik olarak HER TURDA (60sn) kontrol edilmis gibi davranilyor,
ve gercek degisiklikler epoch suresi (5dk) icinde yakalanip bildirilecek -
"2 epoch birlesmis" sorunu ortadan kalkmis olmali.

TEST ONERISI:
- Yukledikten sonra loglarda "selectedPriority" alanina bakin - degisen
  cuzdan sayisini gosterecek.
- errors ve rateLimited alanlarinin hala 0/false kaldigini dogrulayin.
- Birkac epoch boyunca (15-20 dk) bildirimlerin tutarlarinin daha kucuk ve
  duzenli (5 dk'lik tek epoch'a yakin) geldigini kontrol edin.
- Sorun cikarsa: /root/backups altindaki rev9_6_30 yedeklerine donebilirsiniz.

UYGULAMA ADIMLARI:
1. Bu zip dosyasini indirin.
2. PowerShell'de:
   scp "$env:USERPROFILE\Downloads\acki_radar_rev9_6_31.zip" root@87.106.8.140:/tmp/
3. VPS'te:
   cd /var/www/acki-radar/current
   cp src/bot.ts "/root/backups/bot_before_rev9_6_31_$(date +%Y%m%d_%H%M%S).ts"
   cp src/services/ackiProvider.ts "/root/backups/ackiProvider_before_rev9_6_31_$(date +%Y%m%d_%H%M%S).ts"
   unzip -o /tmp/acki_radar_rev9_6_31.zip -d /var/www/acki-radar/current
   pm2 restart acki-radar --update-env
4. Dogrulama:
   grep -n "getAckiAccountsBatchInfo" src/bot.ts src/services/ackiProvider.ts
   pm2 logs acki-radar --timestamp --lines 100
