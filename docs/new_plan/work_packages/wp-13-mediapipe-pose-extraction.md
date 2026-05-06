# WP13 - MediaPipe Pose Extraction

Ilgili sprint: [Sprint 4](../sprints/sprint-04-worker-v1-pose-extraction.md)

## Amac

Backend worker'in normalized video/frame input'undan `pose_frames.json` artifact'i uretmesini saglamak.

## Yapilacaklar

1. `PoseDetector` interface'i tanimla.
2. `MediaPipePoseDetector` implementasyonu yaz.
3. Frame input ve timestamp mapping'i detector'a ver.
4. Per-frame output schema tanimla:
   - frameIndex
   - timestampMs
   - landmarks
   - worldLandmarks
   - visibility/confidence
   - detectorVersion
5. Pose detection progress update ekle.
6. No-person veya low-confidence frame davranisini tanimla.
7. `pose_frames.json` storage artifact olarak yaz.
8. Native mobile pose schema ile uyumluluk dokumani yaz.

## Kabul Kriterleri

- Sample video icin pose frame listesi uretilir.
- Her frame timestamp icerir.
- Confidence/visibility kaybolmaz.
- Detector degistirilebilir interface arkasindadir.
- Failed/no-person durumlari anlamli hata veya quality issue olarak raporlanir.

## Riskler

- MediaPipe Python output koordinatlari native output ile farkli yorumlanabilir.
- World landmarks tek kamera icin tahmindir; gercek reconstruction gibi davranilmamali.
- Uzun videolarda CPU processing suresi yuksek olabilir.

