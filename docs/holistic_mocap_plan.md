# Holistic Performance Capture Plan (Yüz ve Parmak Takibi)

Bu plan, uygulamanın mevcut iskelet takibi (Pose) yeteneklerini genişleterek **Yüz (52 ARKit Blendshapes)** ve **Parmak/El (21+21 = 42 Nokta)** takibini tam entegre etmeyi ve Hollywood standardında tam performans kopyalamayı amaçlar.

## Hedef ve Vizyon
Mocap pazarında "Body-only" (sadece vücut) sistemler standarttır. Yüz ve parmak takibi sunan sistemler (Rokoko Smart Gloves + Faceware) binlerce dolarlık donanımlar gerektirir. Biz bunu sadece akıllı telefon kamerası ile, mevcut removed pose runtime Holistic modelini kullanarak **ücretsiz ve mobil cihazda** gerçekleştireceğiz.

---

## 📅 Aşama 1: Native (C++/Kotlin/Swift) Katmanında Holistic Modelin Aktifleştirilmesi
Mevcut kod tabanımızda veri yapısı (`PoseFrame.ts` içindeki `faceBlendshapes`, `leftHandLandmarks` vb.) zaten hazır. Ancak kameradan gelen görüntünün sadece vücut (Pose) değil, tüm detayları taraması için Native yapının güncellenmesi gerekiyor.
1. **Model Değişimi:** removed pose runtime'ın hafif `Pose` modeli yerine `Holistic` modelinin (veya bağımsız Hand/Face Mesh modellerinin) Native köprüye (JNI/Objective-C++) yüklenmesi.
2. **Performans Optimizasyonu:** Vücut + Yüz + El takibi aynı anda ağır bir işlemdir. Frame Rate'i (FPS) 30'da tutmak için Asenkron Frame Processor (Worklets) ayarlamaları yapılacak.
3. **Blendshape Çıkarımı:** Yüz mimikleri (göz kırpma, ağız açma, gülümseme) için Apple ARKit standartlarındaki 52 adet Blendshape (Morph Target) skorlarının çıkarılması.

## 📅 Aşama 2: Çift Kamera (Multi-View) Senkronizasyonu ve Seçimi
Triangülasyon işlemi, 33 vücut noktası için matematiksel olarak hızlıdır. Ancak yüzdeki 468 nokta ve ellerdeki 42 nokta için iki telefonu eşleştirip SVD matematiği yapmak telefonu çökertebilir veya geciktirebilir.
1. **Akıllı Veri Füzyonu (Smart Fusion):** 
   - Vücut (33 nokta): Her zamanki gibi iki kameradan **Triangülasyon (3D X,Y,Z)** ile kusursuz hesaplanacak.
   - Parmaklar ve Yüz: Hangi kameranın ele veya yüze olan açısı ve "Confidence" (Güven) skoru daha yüksekse, o kameranın ham verisi ana iskelete yapıştırılacak (Local Offset Grafting).
2. **Ağ Trafiği Yönetimi:** Host ve Guest arasında TCP üzerinden gönderilen veri paketi (Payload) boyutu büyüyecek. Bu paketler Float32Array buffer'ları ile sıkıştırılarak (Serialization) iletilecek.

## 📅 Aşama 3: Export Entegrasyonu (FBX / GLTF Morph Targets)
Endüstri standardı olan BVH formatı yüz mimiklerini (Blendshapes) desteklemez. Bu yüzden yüz ve parmak verileri **FBX** ve **GLTF/GLB** formatlarına gömülecektir.
1. **Parmak Kinematiği (Hand IK):** Vücut için yazdığımız `AnimationBake.ts` algoritması ellere doğru genişletilecek. (Wrist -> Thumb, Index, Middle, Ring, Pinky). Toplam 30 ekstra kemik eklenecek.
2. **Face Morph Targets:** GLTF ve FBX Writer modüllerine `Blendshapes` (Ağırlık skorları 0.0 - 1.0 arası) eklenecek. Unreal Engine veya Blender'a karakter atıldığında Metahuman yüzleri doğrudan kullanıcının mimikleriyle konuşacak.
3. **UI / Arayüz Güncellemesi:** Capture ve Setup ekranlarında kullanıcıya `[ ] Sadece Vücut`, `[X] Tam Performans (Vücut + Yüz + El)` seçenekleri sunulacak.

---

## 🏆 Jürideki "Wow Faktörü" Senaryosu
Jüriye sunum yaparken ekranda bir Unreal Engine veya WebGL sahnesi açık olacak.
1. İki telefon yerleştirilecek.
2. Siz kameranın önüne geçip konuşmaya başlayacaksınız.
3. Karakter sadece kollarınızı sallamakla kalmayacak; **jüriye doğru parmağıyla işaret edecek, gülümsediğinizde gülümseyecek ve ağız hareketleriniz sesinizle eşleşecek.**
4. Jürinin "Parmakları ve yüzü nasıl okudunuz?" sorusuna: "Hibrid bir sistem kurduk; vücudu stereoskopik matematikle çift açıdan 3D hesaplarken, detay gerektiren uzuvları asenkron sinir ağları ile ağırlıklandırdık (Blendshapes)" diyerek tam puan alınacak. 🚀
