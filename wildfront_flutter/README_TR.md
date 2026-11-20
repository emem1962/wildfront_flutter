# WILDFRONT 3D — Android + Render Co-op Avcılık Oyunu

**Sürüm:** 2.0.0  
**Android istemcisi:** Flutter + Android WebView  
**3B motor:** Three.js 0.170 (CDN üzerinden ES module)  
**Çok oyunculu sunucu:** Node.js 22 + WebSocket (`ws`)  
**Önerilen ücretsiz barındırma:** Render Web Service (test / küçük arkadaş grubu)

WILDFRONT 3D; birinci şahıs görüş, 3B orman/tepe sahası, prosedürel hayvan modelleri ve animasyonları, hayvan algılama/kaçma davranışları, rüzgâr, yağmur/sis, gece-gündüz döngüsü, iz takibi, sürgülü tüfek ve oda tabanlı eşli oyun özelliklerine sahip oynanabilir bir oyun prototipidir.

> **Gerçekçi beklenti:** Bu proje, oyun döngüsü ve çevrimiçi altyapısı bulunan kapsamlı bir başlangıç sürümüdür; fotogerçekçi AAA yapım değildir. Hayvan, silah, ağaç ve çevre modelleri bu sürümde Three.js geometrilerinden oluşturulur; animasyonlar prosedüreldir. Sesler CC0 stok efektlerinden gelir ve bazıları AI/prosedürel üretilmiştir; gerçek saha kayıtları değildir. APK bu çalışma ortamında Flutter SDK olmadığı için burada derlenemedi. Aşağıdaki Windows betiği yerel Flutter kurulumunda APK oluşturur.

## 1. Oyun özellikleri

### Saha ve atmosfer
- Birinci şahıs kamera, 3B tepelik arazi, orman, patikalar, çalılar ve kayalar.
- Android performansı için instanced ağaç/bitki/taş çizimi.
- Güneş ışığı, sis ve 7 dakikalık hızlandırılmış gece-gündüz döngüsü.
- Multiplayer odalarda ortak hava durumu: açık, sisli veya yağmurlu; yağmur parçacıkları ve CC0 yağmur ambiyansı.
- Pusula, mini harita, anlık rüzgâr bilgisi ve hedef mesafe göstergesi.

### Av simülasyonu
- Kızıl geyik ve yaban domuzu; otlama/dolaşma, oyuncuyu fark etme, ürkme/kaçma, çağrıya yaklaşma ve domuzda saldırı davranışları.
- İz takibi, geyik çağrısı, çömelme ve koşu.
- Dayanıklılık, sağlık, mermi stoğu ve 5 mermilik şarjör.
- Sürgülü tüfek modeli, nişan yakınlaştırması, ateş geri tepmesi, namlu parlaması, hareket salınımı ve doldurma animasyonu.
- Mesafe ve rüzgârın atış doğruluğuna etkisi; temiz atış bonusu ve puanlama.
- Sefer görevi: en az 2 geyik ve 1 temiz atış.

### Multiplayer
- Oda koduyla 8 oyuncuya kadar ortak saha.
- Oyuncu konum/yön senkronizasyonu, diğer avcıların 3B temsili ve isim etiketleri.
- Sunucu tarafında hayvan AI, atış kontrolü, mühimmat, isabet, skor ve saldırı/sağlık yönetimi.
- Ekip puan tablosu ve oda içi sohbet.
- Ortak hayvan durumları, rüzgâr ve hava durumu.
- Render Free üzerinde aktif WebSocket bağlantısını canlı tutmak için 25 saniyede bir uygulama seviyesi ping.

## 2. Android APK üretimi (Windows)

Gereksinimler:
- Flutter SDK ve Android SDK kurulmuş olmalı.
- `flutter doctor` komutunda Android toolchain hatası olmamalı.
- İnternet bağlantısı: Flutter paketlerini, Three.js modülünü ve stok sesleri indirmek için gerekir.

Adımlar:
1. ZIP'i Windows bilgisayarına çıkar.
2. `wildfront_flutter` klasörünün içine gir.
3. `build_apk.bat` dosyasına çift tıkla.
4. Android proje klasörü yoksa betik `flutter create` ile oluşturur; ardından internet izni, yatay ekran ve minimum Android SDK ayarlarını yapar.
5. `flutter pub get` ve `flutter build apk --release` komutlarını çalıştırır.

APK çıktısı:

```text
build\app\outputs\flutter-apk\app-release.apk
```

Komut satırından:

```powershell
flutter doctor
flutter create --platforms=android --org com.wildfront --project-name wildfront_hunter .
powershell -ExecutionPolicy Bypass -File scripts/prepare_android.ps1
flutter pub get
flutter build apk --release
```

**Not:** Android projesi ilk derlemede Flutter tarafından oluşturulur; ZIP'in içinde üretilmiş `android/` klasörü bulunmaz. Bu, makineye özel Gradle/SDK dosyalarının projeye sabitlenmesini önler.

## 3. Render Free sunucusuna dağıtım

### GitHub deposu
1. ZIP'i çıkar.
2. `wildfront_flutter` klasörünün **içindeki dosya ve klasörleri** bir GitHub deposunun köküne yükle. `render.yaml` dosyası depo kökünde, `multiplayer-server/` klasörü de aynı seviyede bulunmalıdır.
3. Render Dashboard: <https://dashboard.render.com/>
4. **New → Blueprint** seçeneğine gir ve GitHub deposunu bağla.
5. Render, kökteki `render.yaml` dosyasını okuyarak Node Web Service'i kurar.
6. Dağıtım tamamlanınca Render servis adresini kopyala. Örnek: `https://wildfront-multiplayer.onrender.com`.
7. Sağlık kontrolü: `https://SERVIS-ADIN.onrender.com/healthz`. JSON yanıtında `ok: true` görülmeli.
8. Oyunun **Arkadaşlarınla Oyna** ekranındaki sunucu adresine `wss://SERVIS-ADIN.onrender.com` yaz. `https://` değil `wss://` kullanılmalıdır.
9. Bir oyuncu **Oda Oluştur** düğmesine basar; üretilen 5 karakterli oda kodunu arkadaşlarına verir. Diğer oyuncular aynı sunucu adresi ve oda koduyla **Odaya Katıl** seçer.

### Elle servis oluşturma
| Render ayarı | Değer |
|---|---|
| Service type | Web Service |
| Runtime | Node |
| Root Directory | `multiplayer-server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Instance Type | Free |
| Region | Frankfurt |

### Render Free sınırları
- Ücretsiz Web Service, 15 dakika boyunca HTTP isteği veya mevcut WebSocket bağlantısı üzerinden uygulama mesajı almazsa uykuya geçer. Oyun istemcisi çevrimiçi oturum açıkken 25 saniyede bir WebSocket mesajı gönderir.
- Uyuyan servis yeni HTTP/WebSocket isteği geldiğinde açılır; ilk bağlantı yaklaşık bir dakika gecikebilir. Oyuncular aynı anda giriyorsa ilk denemede bağlantı gecikirse bir kez daha dene.
- Ücretsiz servisin yerel dosya sistemi kalıcı değildir. Süreç uykuya geçer/yeniden başlarsa bellekteki odalar, skorlar ve oyuncu oturumları kaybolur; tekrar oda kurmak gerekir.
- Ücretsiz servis prototip ve küçük arkadaş grubu testleri içindir; kesintisiz ticari oyun hizmeti için uygun değildir.

Render'ın güncel belgeleri: <https://render.com/docs/free> ve <https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages>.

## 4. Kontroller

### Android
- Sol joystick: yürü / yön değiştir.
- Ekranın boş sağ tarafını sürükle: etrafa bak.
- **NİŞAN:** optik yakınlaştırma ve daha dengeli atış.
- **ATEŞ:** tüfeği ateşle.
- **DOLDUR:** şarjörü tamamla.
- **İZ:** hayvan izlerini göster.
- **ÇAĞRI:** geyik çağrısı; yakındaki geyikleri çekmeye çalışır.
- **ÇÖMEL:** daha yavaş ve sessiz hareket et.
- **KOŞU:** hızlan; dayanıklılık tüket ve hayvanların seni daha uzaktan fark etmesine neden ol.
- **EKİP:** oda puan tablosunu aç.
- **SOHBET:** oda mesajlarını aç.
- Ses simgesi: sesi aç/kapat.

### Bilgisayar / geliştirme testi
- WASD veya ok tuşları: hareket.
- Fare sürükleme: bakış.
- SPACE: ateş.
- F: nişan.
- R: doldur.
- C: çömel.
- Shift: koş.
- T: iz takibi.
- V: geyik çağrısı.
- ESC: duraklat.

## 5. Stok sesler ve lisans

Sesler SFXMint'in CC0 1.0 kitaplığından bağlanır. Kaynak, CC0 lisansını ticari kullanım, değiştirme ve hotlink için açıkça belirtir. Sesler oyun sırasında HTTPS üzerinden akışla yüklenir; bu nedenle ilk kullanımda internet gerekir. Dosyalar APK'ya gömülmediği için paket boyutu düşük kalır. SFXMint, kitaplıktaki seslerin AI/prosedürel olarak üretildiğini bildirir; bunlar gerçek doğa/saha kayıtları değildir.

Tam varlık listesi ve kaynak URL'leri `ASSET_LICENSES_TR.md` dosyasındadır. Ses URL'leri değişirse `assets/game/game.js` içindeki `SOUND_URLS` nesnesinden güncellenebilir.

## 6. Proje yapısı

```text
wildfront_flutter/
├─ lib/main.dart                    # Flutter yatay ekran / tam ekran WebView
├─ assets/game/
│  ├─ index.html                    # Menü, oyun HUD, lobi, ekip ve sohbet
│  ├─ style.css                     # Mobil ve masaüstü arayüzü
│  └─ game.js                       # 3B dünya, AI, silah, ses, client network
├─ multiplayer-server/
│  ├─ server.js                     # Yetkili Node WebSocket sunucusu
│  ├─ package.json
│  └─ .node-version
├─ scripts/prepare_android.ps1      # Manifest / minimum SDK yapılandırması
├─ build_apk.bat                    # Release APK derleme betiği
├─ render.yaml                      # Render Blueprint
├─ ASSET_LICENSES_TR.md             # Stok ses kaynakları / lisans notları
└─ README_TR.md
```

## 7. Yerel multiplayer testi

Node.js 20+ kurulu bir bilgisayarda:

```powershell
cd multiplayer-server
npm install
npm start
```

Oyun sunucu alanına `ws://127.0.0.1:3000` girerek aynı cihazda veya LAN testinde bilgisayar IP adresini kullanarak bağlanabilirsin. Telefon ve PC aynı Wi-Fi ağındaysa Windows Güvenlik Duvarı'nda TCP 3000'e izin ver. İnternet üzerinden gerçek kullanımda Render `wss://` adresini kullan.

## 8. Teknik kapsam ve bilinen sınırlar

- Render Free oda verisini kalıcı saklamaz; hesap, kalıcı profil, cloud save veya sezonluk sıralama bulunmaz.
- Bu sürüm oda başına 8 oyuncu sınırı koyar. Render Free kaynakları nedeniyle gerçek eşzamanlı oyuncu kapasitesi yük ve ağ koşullarında test edilmelidir.
- Hayvan ve çevre modelleri prosedürel, düşük poligonlu oyun modelleridir. GLB/FBX fotogerçekçi animasyon paketleri henüz dahil değildir.
- Oyun sahnesi Three.js'i CDN'den yükler; internet kesikse oyun motoru açılamaz. Sesler de çevrimiçi akışla yüklenir; ses servisi erişilemezse ilgili efekt çalmaz.
- Sesler ve uzak 3B modül yüklenmesi nedeniyle dağıtım öncesi gerçek Android cihazda uzun süreli test yapılmalıdır.
