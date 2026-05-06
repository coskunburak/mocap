# Canlı 3D Avatar Önizlemesi (Live 3D Retargeting) Planı

Bu plan, uygulamanın çekim (Capture) ve izleme (Review) ekranlarındaki basit çubuk adamı (Stickman) kaldırıp yerine **hareketlerinizi birebir, anında ve 3 boyutlu olarak taklit eden tam donanımlı bir 3D Avatar (Robot/Manken)** eklemeyi hedefler. Jürinin aklını başından alacak asıl "Şov" özelliği budur.

---

## 🎯 Vizyon ve Teknik Hedefler
- **Sıfır Gecikme (Zero Latency):** Kameradan gelen 3D noktaların (Landmarks), hiçbir donma olmadan anında 3D karakterin kemiklerine (Bones) aktarılması.
- **Expo & Three.js Entegrasyonu:** React Native'in en güçlü 3D motoru olan `@react-three/fiber` ve `three` kütüphanelerinin kullanılması.
- **Dinamik Rig Eşleştirme:** İskelet matematiklerimizin (Quaternion), dışarıdan yüklenen herhangi bir `.glb` formatlı 3D modelin kemik yapısına (Hierarchy) gerçek zamanlı oturtulması (Real-time Retargeting).

---

## 📅 Aşama 1: Kütüphane ve 3D Asset Hazırlığı
Canlı 3D render işlemi için telefonun GPU'sunu kullanacak olan altyapı kurulacak.
1. **Bağımlılıkların Kurulumu:** `three`, `@react-three/fiber` ve `@react-three/drei` kütüphaneleri projeye eklenecek.
2. **Karakter Modelinin Seçimi:** Düşük poligonlu (Low-poly), performansı yormayacak ama estetik açıdan son derece profesyonel duran bir **Robot veya Unreal Mannequin (.glb)** modeli seçilip uygulamanın `assets/models/` dizinine eklenecek.
3. **Rig Haritası (Bone Mapping):** Seçilen 3D karakterin kemik isimleri (Örn: `mixamorig:RightShoulder`), bizim sistemimizdeki kemik isimleriyle (`RightShoulder`) eşleştirilecek bir sözlük (Map) oluşturulacak.

---

## 📅 Aşama 2: Canlı Kinematik Çözücü (Real-time IK Solver)
Şu anki sistemde rotasyon (Quaternion) hesaplamaları, çekim bittikten sonra *AnimationBake* işlemi sırasında yapılıyor. Bunu gerçek zamanlıya (Real-time) çevirmeliyiz.
1. **LiveSolver.ts Entegrasyonu:** `RotationMath.ts` içindeki `buildJointRotations` algoritması, sadece tek bir kareyi (Frame) okuyup o anki 30 adet kemik rotasyonunu çıkaracak şekilde optimize edilecek.
2. **Yumuşatma (Slerp Interpolation):** Görüntüdeki en ufak bir titreme, 3D karakterin kolunun kırılmasına neden olmasın diye, Three.js'in `quaternion.slerp()` metodu kullanılarak rotasyonlar arası yumuşak geçişler sağlanacak. (One Euro Filter'a ek olarak 3D render yumuşatması).

---

## 📅 Aşama 3: React Three Fiber Sahnesinin Kurulumu
Çekim ekranında çubuk adam yerine geçecek olan 3D Canvas yaratılacak.
1. **LiveAvatarViewer Bileşeni:** Saydam bir `<Canvas>` açılarak kamera görüntüsünün üzerine oturtulacak. İçerisinde ortam ışıkları (`ambientLight`, `directionalLight`) barındıracak.
2. **useFrame Döngüsü (Update Loop):** Three.js'in ekran yenileme hızında çalışan `useFrame` kancası (hook) kullanılarak, saniyede 60 kez (60 FPS) `useCaptureStore.getState().lastFrame` verisi okunacak ve 3D modelin kemiklerine uygulanacak.
3. **UI Geçişi (Toggle):** Kullanıcı Capture ekranındayken bir "Sihirli Değnek" veya "3D" ikonuna basarak *Çubuk Adam* ile *3D Robot* arasında anında geçiş yapabilecek.

---

## 🏆 Jüri Sunum Stratejisi (The Wow Effect)
Sunum sırasında telefonu tripoda yerleştirip, ekranda *3D Avatar* modunu açacaksınız. Siz kameranın karşısına geçtiğiniz an, ekrandaki robot doğrudan ayağa kalkacak, sizinle birlikte ellerini kaldıracak ve yürümeye başlayacak. 

Jüriye açıklama yaparken: *"Gördüğünüz bu robot önceden kaydedilmiş bir animasyon oynatmıyor. Geliştirdiğimiz gerçek zamanlı Ters Kinematik (Real-time Inverse Kinematics) algoritması sayesinde, telefonun işlemcisi vücudumu 33 noktada tarıyor ve 3D motoru saniyede 60 kez güncelleyerek hareketlerimi bu karaktere eşliyor"* dediğinizde, projenin sadece bir veri kayıt aracı değil, **tam teşekküllü bir Artırılmış Gerçeklik (AR) MoCap stüdyosu** olduğunu kanıtlamış olacaksınız.🚀
