# Live 3D Avatar "Cinematic & Holistic" Upgrade Plan

Bu plan, uygulamanın Canlı 3D Avatar önizleme ekranını standart bir 3D görüntüleyiciden çıkarıp, endüstri standardı (AAA Kalite) bir **Artırılmış Gerçeklik (AR) MoCap Gösterge Paneline** dönüştürmeyi amaçlar.

## 🎯 Vizyon
Projenin "Wow" faktörünü maksimize etmek. Avatar sadece hareket etmeyecek; **gülümseyecek, gölgesi yere düşecek, özel ışıklandırmalarla parlayacak ve kamera onu bir drone gibi zekice takip edecek.**

---

## 📅 Aşama 1: Canlı Yüz Mimikleri (Live Morph Targets)
Avatar'ın sadece iskeletini değil, yüzündeki mimikleri (Blendshapes) de gerçek zamanlı aktaracağız.
1. **Blendshape Yakalama:** `useCaptureStore` içindeki `lastFrame.faceBlendshapes` verisi 60 FPS döngüsünün içine dahil edilecek.
2. **Mesh Traversing:** Three.js sahnesindeki `SkinnedMesh` objeleri taranarak `morphTargetDictionary` (Örn: `eyeBlink_L`, `jawOpen`) haritası çıkarılacak.
3. **Weight Mapping:** Apple ARKit isimlendirmesindeki (MediaPipe'dan gelen) mimikler, 3D karakterin Morph Target indekslerine eşlenip `mesh.morphTargetInfluences[index] = score` şeklinde anlık uygulanacak.

---

## 📅 Aşama 2: Akıllı Kamera Takibi (Smart Drone Camera)
Karakter ekranın dışına çıkmasın diye kamera onu yumuşak bir şekilde takip edecek.
1. **Kök Takibi (Root Tracking):** Avatar'ın Kök Kemiği (Hips / Pelvis) referans alınacak.
2. **Lerp Kamera:** `useFrame` içerisinde `camera.lookAt` ve `camera.position.lerp` fonksiyonları kullanılarak kameraya elastik ve sinematik bir "Gecikmeli Takip" (Smooth Follow) efekti verilecek. Sen sağa yürürsen, kamera pürüzsüzce seni kadraja alacak.

---

## 📅 Aşama 3: Sinematik Işıklandırma ve Gölgeler (Premium Aesthetics)
Karakterin uzayda havada süzülüyormuş gibi durmasını engellemek için profesyonel rendering teknikleri uygulanacak.
1. **Contact Shadows:** Karakterin ayaklarının altına `@react-three/drei` kütüphanesinin `ContactShadows` bileşeni eklenecek. Işık hesaplamaları gerçek zamanlı yapılarak zeminde gerçekçi bir gölge oluşturulacak.
2. **Post-Processing (Bloom):** `@react-three/postprocessing` kurularak sahneye hafif bir "Neon Bloom" (Işık Parlaması) ve renk doğrulaması (ToneMapping) eklenecek. Ekrandaki karakter Iron Man arayüzündeki hologramlar kadar premium gözükecek.

---

## 🚀 Sonuç ve Jüri Etkisi
Uygulama çalıştırıldığında, jüri sadece hareket eden çizgiler değil; **gerçekçi gölgelere sahip, yüzüyle seninle aynı tepkileri veren, parlak ve kendini zekice ekranda tutan profesyonel bir 3D MetaHuman** görecek. Bu, projenin %100 oranında "Silikon Vadisi Standardında" olduğunu kanıtlayacak.
