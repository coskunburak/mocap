package com.anonymous.MocapExpo.pose

import android.content.Context
import androidx.camera.core.ImageProxy
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.framework.image.MediaImageBuilder
import com.google.mediapipe.tasks.components.containers.Category
import com.google.mediapipe.tasks.components.containers.Landmark
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarker
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarkerResult
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import java.util.Optional
import java.util.concurrent.atomic.AtomicBoolean

class PoseLandmarkerRunner(
  private val context: Context,
) {

  enum class TrackingProfile(val value: String) {
    POSE("pose"),
    HOLISTIC("holistic"),
  }

  enum class TrackingProfileRequest(val value: String) {
    AUTO("auto"),
    POSE("pose"),
    HOLISTIC("holistic"),
    ;

    companion object {
      fun fromValue(value: String): TrackingProfileRequest? {
        return entries.firstOrNull { it.value == value }
      }
    }
  }

  data class Config(
    val poseModelName: String,
    val holisticModelName: String,
    val modelExt: String = "task",
    val trackingProfile: TrackingProfileRequest = TrackingProfileRequest.AUTO,
    val minPoseConfidence: Float = 0.5f,
    val minTrackingConfidence: Float = 0.5f,
    val minPresenceConfidence: Float = 0.5f,
    val minFaceConfidence: Float = 0.5f,
    val minHandConfidence: Float = 0.5f,
    val outputFaceBlendshapes: Boolean = true,
    val outputPoseSegmentationMasks: Boolean = false,
    val numPoses: Int = 1,
    val usesCpu: Boolean = true,
    val debug: Boolean = false,
  )

  data class FramePayload(
    val timestampMs: Long,
    val trackingProfile: String,
    val requestedTrackingProfile: String,
    val landmarks: List<LandmarkPayload>,
    val worldLandmarks: List<LandmarkPayload> = emptyList(),
    val faceLandmarks: List<LandmarkPayload> = emptyList(),
    val leftHandLandmarks: List<LandmarkPayload> = emptyList(),
    val leftHandWorldLandmarks: List<LandmarkPayload> = emptyList(),
    val rightHandLandmarks: List<LandmarkPayload> = emptyList(),
    val rightHandWorldLandmarks: List<LandmarkPayload> = emptyList(),
    val faceBlendshapes: List<BlendshapePayload> = emptyList(),
    val hasPoseSegmentationMask: Boolean? = null,
  ) {
    fun toWritableMap(): WritableMap {
      val map = Arguments.createMap()
      map.putDouble("timestampMs", timestampMs.toDouble())
      map.putString("trackingProfile", trackingProfile)
      map.putString("requestedTrackingProfile", requestedTrackingProfile)
      map.putArray("landmarks", landmarks.toLandmarkWritableArray())
      map.putArray("worldLandmarks", worldLandmarks.toLandmarkWritableArray())

      if (faceLandmarks.isNotEmpty()) {
        map.putArray("faceLandmarks", faceLandmarks.toLandmarkWritableArray())
      }
      if (leftHandLandmarks.isNotEmpty()) {
        map.putArray("leftHandLandmarks", leftHandLandmarks.toLandmarkWritableArray())
      }
      if (leftHandWorldLandmarks.isNotEmpty()) {
        map.putArray("leftHandWorldLandmarks", leftHandWorldLandmarks.toLandmarkWritableArray())
      }
      if (rightHandLandmarks.isNotEmpty()) {
        map.putArray("rightHandLandmarks", rightHandLandmarks.toLandmarkWritableArray())
      }
      if (rightHandWorldLandmarks.isNotEmpty()) {
        map.putArray("rightHandWorldLandmarks", rightHandWorldLandmarks.toLandmarkWritableArray())
      }
      if (faceBlendshapes.isNotEmpty()) {
        map.putArray("faceBlendshapes", faceBlendshapes.toBlendshapeWritableArray())
      }
      if (hasPoseSegmentationMask != null) {
        map.putBoolean("hasPoseSegmentationMask", hasPoseSegmentationMask)
      }
      return map
    }
  }

  data class LandmarkPayload(
    val id: Int,
    val x: Double,
    val y: Double,
    val z: Double,
    val v: Double,
  )

  data class BlendshapePayload(
    val index: Int,
    val name: String,
    val score: Double,
    val displayName: String?,
  )

  private val lock = Any()
  private val inFlight = AtomicBoolean(false)

  private var poseLandmarker: PoseLandmarker? = null
  private var holisticLandmarker: HolisticLandmarker? = null
  private var pendingImageProxy: ImageProxy? = null
  private var onOutput: ((FramePayload) -> Unit)? = null
  private var onError: ((String) -> Unit)? = null
  private var isRunning = false
  private var activeProfile = TrackingProfile.POSE
  private var requestedProfile = TrackingProfileRequest.AUTO

  @Throws(Exception::class)
  fun start(
    config: Config,
    onOutput: (FramePayload) -> Unit,
    onError: (String) -> Unit,
  ) {
    synchronized(lock) {
      stopLocked()

      this.onOutput = onOutput
      this.onError = onError
      this.requestedProfile = config.trackingProfile
      this.activeProfile = resolveProfile(config)

      try {
        when (activeProfile) {
          TrackingProfile.POSE -> startPoseLandmarker(config)
          TrackingProfile.HOLISTIC -> startHolisticLandmarker(config)
        }
        isRunning = true
      } catch (error: Throwable) {
        stopLocked()
        throw error
      }
    }
  }

  fun stop() {
    synchronized(lock) {
      stopLocked()
    }
  }

  fun process(imageProxy: ImageProxy) {
    val currentProfile: TrackingProfile
    val poseTask: PoseLandmarker?
    val holisticTask: HolisticLandmarker?
    val currentError: ((String) -> Unit)?

    synchronized(lock) {
      if (!isRunning) {
        imageProxy.close()
        return
      }

      if (!inFlight.compareAndSet(false, true)) {
        imageProxy.close()
        return
      }

      val mediaImage = imageProxy.image
      if (mediaImage == null) {
        inFlight.set(false)
        imageProxy.close()
        return
      }

      pendingImageProxy = imageProxy
      currentProfile = activeProfile
      poseTask = poseLandmarker
      holisticTask = holisticLandmarker
      currentError = onError
    }

    val timestampMs = imageProxy.imageInfo.timestamp / 1_000_000L
    val mpImage = MediaImageBuilder(imageProxy.image!!).build()
    val imageProcessingOptions =
      ImageProcessingOptions.builder()
        .setRotationDegrees(imageProxy.imageInfo.rotationDegrees)
        .build()

    try {
      when (currentProfile) {
        TrackingProfile.POSE -> {
          val task = poseTask ?: throw IllegalStateException("Pose landmarker is not initialized.")
          task.detectAsync(mpImage, imageProcessingOptions, timestampMs)
        }
        TrackingProfile.HOLISTIC -> {
          val task =
            holisticTask ?: throw IllegalStateException("Holistic landmarker is not initialized.")
          task.detectAsync(mpImage, imageProcessingOptions, timestampMs)
        }
      }
    } catch (error: Throwable) {
      releasePendingImage()
      currentError?.invoke("detectAsync failed: ${error.message ?: error}")
    } finally {
      mpImage.close()
    }
  }

  private fun stopLocked() {
    pendingImageProxy?.close()
    pendingImageProxy = null

    poseLandmarker?.close()
    holisticLandmarker?.close()

    poseLandmarker = null
    holisticLandmarker = null
    onOutput = null
    onError = null
    isRunning = false
    activeProfile = TrackingProfile.POSE
    requestedProfile = TrackingProfileRequest.AUTO
    inFlight.set(false)
  }

  private fun resolveProfile(config: Config): TrackingProfile {
    return when (config.trackingProfile) {
      TrackingProfileRequest.POSE -> {
        ensureModelExists(config.poseModelName, config.modelExt)
        TrackingProfile.POSE
      }
      TrackingProfileRequest.HOLISTIC -> {
        ensureModelExists(config.holisticModelName, config.modelExt)
        TrackingProfile.HOLISTIC
      }
      TrackingProfileRequest.AUTO -> {
        if (bundledModelExists(config.holisticModelName, config.modelExt)) {
          TrackingProfile.HOLISTIC
        } else {
          ensureModelExists(config.poseModelName, config.modelExt)
          TrackingProfile.POSE
        }
      }
    }
  }

  private fun baseOptions(modelAssetPath: String, usesCpu: Boolean): BaseOptions {
    return BaseOptions.builder()
      .setModelAssetPath(modelAssetPath)
      .setDelegate(
        if (usesCpu) {
          Delegate.CPU
        } else {
          Delegate.GPU
        },
      )
      .build()
  }

  private fun startPoseLandmarker(config: Config) {
    ensureModelExists(config.poseModelName, config.modelExt)

    val options =
      PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(baseOptions("${config.poseModelName}.${config.modelExt}", config.usesCpu))
        .setRunningMode(RunningMode.LIVE_STREAM)
        .setNumPoses(maxOf(1, config.numPoses))
        .setMinPoseDetectionConfidence(clamp01(config.minPoseConfidence))
        .setMinPosePresenceConfidence(clamp01(config.minPresenceConfidence))
        .setMinTrackingConfidence(clamp01(config.minTrackingConfidence))
        .setOutputSegmentationMasks(config.outputPoseSegmentationMasks)
        .setResultListener { result: PoseLandmarkerResult, _: MPImage ->
          handlePoseResult(result)
        }
        .setErrorListener { error ->
          handleTaskError("PoseLandmarker error: ${error.message ?: "Unknown"}")
        }
        .build()

    poseLandmarker = PoseLandmarker.createFromOptions(context, options)
    holisticLandmarker = null
  }

  private fun startHolisticLandmarker(config: Config) {
    ensureModelExists(config.holisticModelName, config.modelExt)

    val options =
      HolisticLandmarker.HolisticLandmarkerOptions.builder()
        .setBaseOptions(baseOptions("${config.holisticModelName}.${config.modelExt}", config.usesCpu))
        .setRunningMode(RunningMode.LIVE_STREAM)
        .setMinFaceDetectionConfidence(clamp01(config.minFaceConfidence))
        .setMinFacePresenceConfidence(clamp01(config.minFaceConfidence))
        .setMinPoseDetectionConfidence(clamp01(config.minPoseConfidence))
        .setMinPosePresenceConfidence(clamp01(config.minPresenceConfidence))
        .setMinHandLandmarksConfidence(clamp01(config.minHandConfidence))
        .setOutputFaceBlendshapes(config.outputFaceBlendshapes)
        .setOutputPoseSegmentationMasks(config.outputPoseSegmentationMasks)
        .setResultListener { result: HolisticLandmarkerResult, _: MPImage ->
          handleHolisticResult(result)
        }
        .setErrorListener { error ->
          handleTaskError("HolisticLandmarker error: ${error.message ?: "Unknown"}")
        }
        .build()

    holisticLandmarker = HolisticLandmarker.createFromOptions(context, options)
    poseLandmarker = null
  }

  private fun handlePoseResult(result: PoseLandmarkerResult) {
    releasePendingImage()

    val callback: ((FramePayload) -> Unit)?
    val requestedProfileValue: String
    synchronized(lock) {
      if (!isRunning) {
        return
      }
      callback = onOutput
      requestedProfileValue = requestedProfile.value
    }

    val firstLandmarks = result.landmarks().firstOrNull().orEmpty()
    val firstWorldLandmarks = result.worldLandmarks().firstOrNull().orEmpty()

    callback?.invoke(
      FramePayload(
        timestampMs = result.timestampMs(),
        trackingProfile = TrackingProfile.POSE.value,
        requestedTrackingProfile = requestedProfileValue,
        landmarks = encodeNormalizedLandmarks(firstLandmarks),
        worldLandmarks = encodeWorldLandmarks(firstWorldLandmarks),
        hasPoseSegmentationMask = result.segmentationMasks().map { it.isNotEmpty() }.orElse(false),
      ),
    )
  }

  private fun handleHolisticResult(result: HolisticLandmarkerResult) {
    releasePendingImage()

    val callback: ((FramePayload) -> Unit)?
    val requestedProfileValue: String
    synchronized(lock) {
      if (!isRunning) {
        return
      }
      callback = onOutput
      requestedProfileValue = requestedProfile.value
    }

    callback?.invoke(
      FramePayload(
        timestampMs = result.timestampMs(),
        trackingProfile = TrackingProfile.HOLISTIC.value,
        requestedTrackingProfile = requestedProfileValue,
        landmarks = encodeNormalizedLandmarks(result.poseLandmarks()),
        worldLandmarks = encodeWorldLandmarks(result.poseWorldLandmarks()),
        faceLandmarks = encodeNormalizedLandmarks(result.faceLandmarks()),
        leftHandLandmarks = encodeNormalizedLandmarks(result.leftHandLandmarks()),
        leftHandWorldLandmarks = encodeWorldLandmarks(result.leftHandWorldLandmarks()),
        rightHandLandmarks = encodeNormalizedLandmarks(result.rightHandLandmarks()),
        rightHandWorldLandmarks = encodeWorldLandmarks(result.rightHandWorldLandmarks()),
        faceBlendshapes = encodeBlendshapes(result.faceBlendshapes().orElse(emptyList())),
        hasPoseSegmentationMask = result.segmentationMask().isPresent,
      ),
    )
  }

  private fun handleTaskError(message: String) {
    releasePendingImage()

    val errorCallback = synchronized(lock) {
      if (!isRunning) {
        null
      } else {
        onError
      }
    }
    errorCallback?.invoke(message)
  }

  private fun releasePendingImage() {
    synchronized(lock) {
      pendingImageProxy?.close()
      pendingImageProxy = null
      inFlight.set(false)
    }
  }

  private fun ensureModelExists(name: String, ext: String) {
    if (!bundledModelExists(name, ext)) {
      throw IllegalStateException(
        "Model not found in bundle: $name.$ext. Verify android/app/src/main/assets contains the task file.",
      )
    }
  }

  private fun bundledModelExists(name: String, ext: String): Boolean {
    return try {
      context.assets.open("$name.$ext").use { true }
    } catch (_: Exception) {
      false
    }
  }

  private fun encodeNormalizedLandmarks(landmarks: List<NormalizedLandmark>): List<LandmarkPayload> {
    return landmarks.mapIndexed { index, landmark ->
      LandmarkPayload(
        id = index,
        x = landmark.x().toDouble(),
        y = landmark.y().toDouble(),
        z = landmark.z().toDouble(),
        v = landmarkConfidence(landmark.visibility(), landmark.presence()),
      )
    }
  }

  private fun encodeWorldLandmarks(landmarks: List<Landmark>): List<LandmarkPayload> {
    return landmarks.mapIndexed { index, landmark ->
      LandmarkPayload(
        id = index,
        x = landmark.x().toDouble(),
        y = landmark.y().toDouble(),
        z = landmark.z().toDouble(),
        v = landmarkConfidence(landmark.visibility(), landmark.presence()),
      )
    }
  }

  private fun encodeBlendshapes(categories: List<Category>): List<BlendshapePayload> {
    return categories.map { category ->
      BlendshapePayload(
        index = category.index(),
        name = category.categoryName(),
        score = category.score().toDouble(),
        displayName = category.displayName().takeUnless { it.isNullOrEmpty() },
      )
    }
  }

  private fun landmarkConfidence(
    visibility: Optional<Float>,
    presence: Optional<Float>,
  ): Double {
    if (visibility.isPresent) {
      return visibility.get().toDouble()
    }
    if (presence.isPresent) {
      return presence.get().toDouble()
    }
    return 1.0
  }

  private fun clamp01(value: Float): Float = value.coerceIn(0f, 1f)
}

private fun List<PoseLandmarkerRunner.LandmarkPayload>.toLandmarkWritableArray(): WritableArray {
  val array = Arguments.createArray()
  forEach { landmark ->
    val item = Arguments.createMap()
    item.putInt("id", landmark.id)
    item.putDouble("x", landmark.x)
    item.putDouble("y", landmark.y)
    item.putDouble("z", landmark.z)
    item.putDouble("v", landmark.v)
    array.pushMap(item)
  }
  return array
}

private fun List<PoseLandmarkerRunner.BlendshapePayload>.toBlendshapeWritableArray(): WritableArray {
  val array = Arguments.createArray()
  forEach { blendshape ->
    val item = Arguments.createMap()
    item.putInt("index", blendshape.index)
    item.putString("name", blendshape.name)
    item.putDouble("score", blendshape.score)
    if (blendshape.displayName != null) {
      item.putString("displayName", blendshape.displayName)
    }
    array.pushMap(item)
  }
  return array
}
