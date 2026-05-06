# Production Dual Camera Mocap Pipeline v1

Bu döküman, MocapExpo projesinde "Move AI" kalitesinde bir çift kamera (dual-camera) hareket yakalama hattı oluşturmak için gerekli olan teknik detayları ve uygulama adımlarını içerir. Mevcut `PeerHost`, `PeerGuest`, `Triangulator` gibi bileşenlerin üzerine inşa edilerek profesyonel bir ürün seviyesine taşınması hedeflenmektedir.

## Mimari Hedef (End-to-End Pipeline)

İki iPhone cihazı farklı açılardan çekim yapar. Guest cihaz landmark verilerini Host'a gönderir. Host; zaman senkronizasyonu, frame eşleme ve stereo triangülasyon yaparak gerçek zamanlı 3D landmark üretir. Bu veri bir 3D robot avatar üzerinde görselleştirilir ve kayıt sonrası temizlenmiş (cleaned/baked) şekilde Blender/Unity için export edilir.

---

## Aşama 1: Dual Device Connection Production MVP
Mevcut P2P katmanını stabilite ve hata toleransı açısından güçlendirmek.

- **TCP Server & Discovery:** Host TCP server açar. Guest QR veya IP ile bağlanır.
- **Handshake & Validation:** Protokol versiyonu, uygulama sürümü ve session ID doğrulaması.
- **Robustness:** 
  - Keepalive (Ping/Pong) mekanizması ile bağlantı takibi.
  - Otomatik reconnect ve session recovery.
  - Hata durumlarında (Wi-Fi kopması vb.) net kullanıcı uyarıları.
- **Host Dashboard:** Guest'in FPS, latency, batarya durumu ve tracking state (MediaPipe kalitesi) canlı izlenir.

**Acceptance:** 10 dakika boyunca kopmadan 30 FPS landmark akışı.

---

## Aşama 2: Time Sync & Frame Matching Debug
İki cihazın saatlerini mikrosaniye hassasiyetinde senkronize etmek ve kareleri doğru eşleştirmek.

- **Clock Offset Histogram:** NTP benzeri algoritma ile RTT p95 ve median değerlerinin ölçümü.
- **Match Tolerance:** 16ms, 24ms, 33ms gibi dinamik tolerans ayarları.
- **Drop Analysis:** Eşleşmeyen karelerin neden atıldığının (late, early, low confidence) takibi.
- **Debug Overlay:** Host üzerinde remote frame gecikmesini gösteren canlı grafikler.

**Acceptance:** Kare eşleşme oranı %85+. Ortalama delta < 24ms.

---

## Aşama 3: Stereo Calibration MVP
Triangülasyonun doğruluğunu belirleyen en kritik aşama.

- **Wizard Flow:**
  1. **A-Pose Center:** Merkeze geçiş.
  2. **Step Left/Right:** Derinlik algısı için yanlara adım.
  3. **Arms Up:** Omuz/Kol doğrulaması.
- **Kalite Metrikleri:**
  - Reprojection Error (Piksel cinsinden hata).
  - Convergence Angle (Kamera açılarının uygunluğu).
  - Baseline Sanity (Kameralar arası mesafe mantıklılığı).
- **Gating:** Kalite skoru < 0.7 ise çekim başlatılamaz, tekrar konumlandırma istenir.

**Acceptance:** Her take için calibration metadata kaydı ve hata kontrolü.

---

## Aşama 4: Triangulation Pipeline
2D veriyi 3D'ye dönüştürürken kullanılan temizlik katmanı.

- **Confidence Gating:** Düşük confidence'lı 2D landmark'ların (örn. görünmeyen diz kapağı) triangülasyona alınmaması.
- **Reprojection Gate:** Triangülasyon sonucu çıkan noktanın reprojection hatası yüksekse reddedilmesi.
- **Interpolation:** Kayıp eklemlerin (missing joints) önceki iyi karelerden veya iskelet yapısından tahmin edilmesi.
- **Cleanup:** Ayak kaymasını (sliding) önleyici basit derinlik filtreleri.

---

## Aşama 5: 3D Robot Avatar Sistemi
2D iskelet yerine gerçek bir 3D humanoid karakterin (Robot) varsayılan olması.

- **Asset Standardı:** Low-poly, humanoid rig, local bundle .glb.
- **Retargeting:** MediaPipe landmark'larının robot kemiklerine (Hips, Spine, UpperArm vb.) aktarılması.
- **Hands & Face:** El bileği orientasyonu ve temel kafa hareketlerinin eklenmesi.
- **Smoothness:** Jitter (titreme) engelleyici One-Euro Filter gibi algoritmalar.

**Acceptance:** Canlı önizlemede ve export'ta aynı solver sonucunun görülmesi.

---

## Aşama 6: Take Format v2
Verinin hata analizi yapılabilir şekilde saklanması.

```json
{
  "takeId": "uuid",
  "rawViews": {
    "host": { "landmarks2D": "..." },
    "guest": { "landmarks2D": "..." }
  },
  "calibration": { "P1": "...", "P2": "...", "score": 0.85 },
  "triangulated3D": "...",
  "cleanedSkeleton": "...",
  "metadata": { "fps": 30, "droppedFrames": 12 }
}
```

---

## Aşama 7: Skeleton Solver & Export
Blender ve Unity için profesyonel çıktı üretimi.

- **Bone Length Stability:** Kemik uzunluklarının her karede aynı kalması (Constraint).
- **Limb Quaternions:** Landmark koordinatlarından quaternion rotasyonlarına dönüşüm.
- **Foot Locking:** Ayakların zemine temasında sabitlenmesi (Sliding engelleme).
- **Formatlar:** .BVH ve .GLB (Animasyonlu).

---

## Aşama 8: Production Quality Dashboard
Kullanıcıya çekimin kalitesini söyleyen rapor ekranı.

- **Take Quality Score:** Calibration, dropped frame ve jitter verilerine göre 0-100 arası puan.
- **Recommendations:** "Calibration failed", "Needs cleanup" veya "Ready for export" durumları.

---

## İlk Milestone (Başlangıç Hedefleri)

1.  **MultiViewSetup Yenileme:** Move AI tarzı adım adım setup flow.
2.  **Bağlantı Sağlamlaştırma:** Gerçek cihazda (Physical device) TCP kopmalarının yönetimi.
3.  **Debug Panel:** Host ekranında Remote FPS ve Match/Drop sayıları.
4.  **3D Robot Preview:** 2D çizgiler yerine varsayılan olarak robotun gösterilmesi.
5.  **Remote Pose Visualization:** Remote cihazdan gelen landmark'ların host ekranında ufak bir pencerede (PIP) canlı görünmesi.
