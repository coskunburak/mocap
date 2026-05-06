# Production-Ready Animation & Export Plan

Bu plan, hareket yakalama (MoCap) verisini endüstri standardı kalitesine (Unreal Engine, Blender uyumlu) taşımak için gereken Filtreleme ve Rotasyon (BVH) dönüşümü adımlarını kapsar.

## Phase 1: İleri Düzey Filtreleme (One Euro Filter)
Basit hareketli ortalama (Moving Average) hızlı hareketlerde gecikme (lag) yaratır. **One Euro Filter**, hıza duyarlı bir filtredir; karakter yavaşken titremeyi agresifçe keser, karakter hızlıyken gecikmeyi önlemek için filtreyi azaltır.
1. **`OneEuroFilter.ts`** oluşturulacak.
2. `TakeReviewAnalyzer` veya doğrudan `ReviewScreen` içerisine entegre edilecek. 
3. Kullanıcı, oynatıcı üzerinden "Smoothing" seviyesini (kapalı, hafif, agresif) ayarlayabilecek veya dışa aktarımda bu filtre uygulanmış veriyi kullanabilecek.

## Phase 2: Kinematik Çözücü (Positions to Rotations)
Blender ve Unreal Engine, noktaların nerede olduğuyla (x, y, z) ilgilenmez. Eklemlerin **hangi eksende kaç derece döndüğüyle (Rotations)** ilgilenir.
1. **`SkeletonHierarchy.ts`**: MediaPipe'ın karmaşık 33 noktasını standart animasyon kemiklerine (Pelvis -> Spine -> Neck -> Head, Pelvis -> Femur -> Tibia -> Foot vb.) bağlayan ebeveyn-çocuk (parent-child) ağacı tanımlanacak.
2. **`Math3D.ts`**: Saf TypeScript ile Quaternion, Vector3, Cross Product, Dot Product ve Euler dönüşüm matematiği eklenecek.
3. **`KinematicsSolver.ts`**: Her bir frame için 3D nokta bulutunu alıp, kemik vektörlerini hesaplayıp bunları Parent kemiğine göre **Local Euler Acılarına (Z-X-Y)** veya **Quaternion'a** dönüştürecek.

## Phase 3: .BVH Formatı Dışa Aktarıcı (Exporter)
Endüstri standardı hareket formatı olan BVH iki bölümden oluşur: Hiyerarşi (Skeleton T-Pose yapısı) ve Hareket (Her frame için açı değerleri).
1. **`BvhExporter.ts`**: 
   - `HIERARCHY`: Sistemdeki kemiklerin sabit uzunluklarına göre (ilk frame veya kalibrasyon frame'i baz alınarak) offset'ler hesaplanacak.
   - `MOTION`: Kinematik çözücüden çıkan Euler açıları saniyedeki frame (FPS) sayısına göre satır satır yazdırılacak.
2. **`ExportScreen.tsx`**: Dışa aktarma ekranına "BVH (Blender/Unreal/Maya)" seçeneği eklenecek. Kullanıcı filtreli (Smoothed) veya ham (Raw) halini BVH olarak çıkarabilecek.

## Aşama Durumu
* Aşama 1: Bekliyor
* Aşama 2: Bekliyor
* Aşama 3: Bekliyor

Onayınızla birlikte Aşama 1 (One Euro Filter) ve Aşama 2 (3D Math & Kinematics) inşasına başlayacağım.
