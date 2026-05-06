# Canlı 3D Avatar — 3 Aşamalı Production-Ready Uygulama Planı

---

## 📋 AŞAMA 1: Canlı Yüz Mimikleri (Live Face Morph Targets)

### Problem Analizi
Mevcut kod basit bir `dict[name]` eşleştirmesi yapıyor. Bu production-ready DEĞİLDİR çünkü:
- MediaPipe'ın 52 Blendshape ismi (`eyeBlinkLeft`) ile popüler 3D modellerin isim formatları (`EyeBlink_L`, `eye_blink_left`, `eyeBlink_L`) arasında **standart bir eşleşme yoktur**.
- Her `useFrame` çağrısında tüm mesh'ler ve tüm blendshape'ler üzerinde O(N×M) döngü çalışıyor — bu mobil GPU'da frame drop'a yol açabilir.
- Blendshape skoru sıfırın altına düşebilir veya 1'i aşabilir (clamp eksik).

### Uygulama Detayları
1. **ARKit → Model Blendshape Sözlüğü (Alias Map):** 52 adet ARKit standart isim için tüm yaygın varyasyonları (camelCase, snake_case, PascalCase, kısa adlar) barındıran statik bir `BLENDSHAPE_ALIASES` haritası oluşturulacak. Bu harita modelden bağımsız olarak **her zaman** çalışacak.
2. **Ön-Hesaplanmış Index Haritası (Pre-computed Index Cache):** İlk frame geldiğinde mesh'in `morphTargetDictionary`'si tek seferlik taranıp, `Map<string, number>` olarak cache'lenecek. Sonraki frame'lerde O(1) erişim sağlanacak.
3. **Influence Clamping & Deadzone:** Skor `clamp(0, 1)` ile sınırlanacak. 0.02'nin altındaki skorlar sıfır olarak kabul edilecek (mikro-titremeleri önlemek için).
4. **Adaptive Lerp Speed:** Gülümseme gibi yavaş mimikler ile göz kırpma gibi hızlı mimikler için farklı interpolasyon hızları (`fastLerp` vs `slowLerp`) uygulanacak.

---

## 📋 AŞAMA 2: Akıllı Sinematik Kamera Sistemi (Smart Drone Camera)

### Problem Analizi
Mevcut kod her frame'de `camera.lookAt()` çağırıyor. Bu production-ready DEĞİLDİR çünkü:
- `lookAt()` anında bir snap (sıçrama) yapar. Hızlı hareketlerde kamera titrer (judder).
- Kamera, karakter çok yukarı/aşağı gitse bile aynı yükseklikte kalır ve karakter kesilir.
- Kameraya yatay sınır (dead-zone) yoktur — karakter ekranın ortasında sabit kalır, bu da doğal değildir.

### Uygulama Detayları
1. **Smooth LookAt (Quaternion Slerp):** `camera.lookAt()` yerine hedef rotasyonu bir `THREE.Quaternion` olarak hesaplayıp, `camera.quaternion.slerp()` ile pürüzsüz geçiş sağlanacak.
2. **Dead-Zone (Ölü Bölge):** Karakter ekranın merkez %30'luk alanında kaldığı sürece kamera hiç hareket etmeyecek. Sadece bu alanın dışına çıktığında kamera yumuşakça takip edecek. Bu, profesyonel bir oyun kamerası hissi verir.
3. **Vertical Follow with Clamp:** Kameranın Y ekseni (yükseklik) 0.5 ile 2.0 arasında sınırlanacak. Karakter yere çömeldiğinde kamera da yumuşakça alçalacak, ama asla zemine girmeyecek.
4. **Orbit Control Gesture (Opsiyonel):** Kullanıcının tek parmakla 3D sahneyi döndürebilmesi için `@react-three/drei`'nin `OrbitControls` bileşeni eklenecek (kayıt dışıyken aktif, kayıt sırasında otomatik takip).

---

## 📋 AŞAMA 3: Sinematik Işıklandırma ve Premium Rendering

### Problem Analizi
Mevcut sahnede basit `ambientLight` + `directionalLight` + `ContactShadows` var. Bu iyi bir başlangıç ama production-ready DEĞİLDİR çünkü:
- Gölgeler yere yapışık (Contact Shadow) ama gerçekçi derinlikleri yok.
- Karakter tek renkli görünüyor çünkü **Rim Light** (kenar aydınlatma) eksik.
- Sahne arka planı tamamen siyah, bu da AR hissini kırıyor.

### Uygulama Detayları
1. **3-Point Lighting (Profesyonel Stüdyo Işığı):**
   - **Key Light:** Sağ üstten güçlü yönlü ışık (ana karakter aydınlatması).
   - **Fill Light:** Sol alttan yumuşak renkli ışık (gölgelerin sertliğini kırmak için).
   - **Rim/Back Light:** Arka-üstten keskin ışık (karakterin kenarlarını parlatarak onu arka plandan ayırmak — sinema standardı).
2. **Transparent Canvas Background:** Three.js Canvas'ının `alpha: true` ile şeffaf hale getirilmesi. Böylece kamera görüntüsünün arkasından geçerek, 3D karakter sanki gerçek dünyanın içindeymiş gibi görünür (AR efekti).
3. **Grid Floor (Zayıf Referans Zemini):** Karakterin ayaklarının altına çok zayıf (`opacity: 0.15`) bir grid çizgisi eklenecek. Bu, derinlik algısını güçlendirir ve profesyonel MoCap stüdyolarındaki standart görüntüyü taklit eder.
4. **Tone Mapping ve Exposure:** Three.js renderer'a `ACESFilmicToneMapping` uygulanacak. Bu, Hollywood filmlerinde kullanılan standart renk eşleme algoritmasıdır ve 3D sahnedeki renkleri daha sinematik yapar.

---

> **Sonuç:** Bu 3 aşama tamamlandığında, telefonun ekranında gördüğünüz 3D karakter bir öğrenci projesindeki basit 3D obje gibi değil; **Rokoko, Xsens veya Unreal MetaHuman stüdyolarındaki gibi profesyonel bir Artırılmış Gerçeklik (AR) MoCap aracı** gibi görünecek ve davranacak.
