package com.anonymous.MocapExpo.pose

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

class PoseEngineModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private companion object {
    const val MODULE_NAME = "PoseEngineModule"
    const val EVENT_FRAME = "PoseEngineFrame"
    const val EVENT_STATUS = "PoseEngineStatus"

    const val STATUS_IDLE = "idle"
    const val STATUS_STARTING = "starting"
    const val STATUS_RUNNING = "running"
    const val STATUS_STOPPING = "stopping"
    const val STATUS_ERROR = "error"

    const val ERROR_CAMERA_PERMISSION = "E_CAMERA_PERMISSION"
    const val ERROR_START = "E_START"
    const val ERROR_STOP = "E_STOP"
    const val ERROR_OPTIONS = "E_OPTIONS"
  }

  private enum class EngineState(val value: String) {
    IDLE(STATUS_IDLE),
    STARTING(STATUS_STARTING),
    RUNNING(STATUS_RUNNING),
    STOPPING(STATUS_STOPPING),
    ERROR(STATUS_ERROR),
  }

  private val moduleExecutor = Executors.newSingleThreadExecutor()
  private val inferenceExecutor = Executors.newSingleThreadExecutor()
  private val stateLock = Any()

  private var state = EngineState.IDLE
  private var hasListeners = false
  private var listenerCount = 0
  private var sessionId = 0L
  private var inputFrameCounter = 0
  private var previewActive = false
  private var lastEmitEveryNthFrame = 1
  private var lastTargetFps = 30

  private var runner: PoseLandmarkerRunner? = null

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun addListener(_eventName: String) {
    moduleExecutor.execute {
      val shouldEmit = synchronized(stateLock) {
        listenerCount += 1
        val becameActive = !hasListeners
        hasListeners = true
        becameActive
      }
      if (shouldEmit) {
        sendStatus("listener_on")
      }
    }
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    moduleExecutor.execute {
      synchronized(stateLock) {
        listenerCount = maxOf(0, listenerCount - count)
        hasListeners = listenerCount > 0
      }
    }
  }

  @ReactMethod
  fun ping(promise: Promise) {
    val result = Arguments.createMap()
    result.putBoolean("ok", true)
    result.putString("version", "poseengine-android-5.1")
    result.putString("poseModel", resolvePoseModelName("full"))
    result.putBoolean("holisticAvailable", bundledModelExists("holistic_landmarker"))
    promise.resolve(result)
  }

  @ReactMethod
  fun setPreviewActive(active: Boolean, promise: Promise) {
    moduleExecutor.execute {
      previewActive = active
      val currentState = synchronized(stateLock) { state }

      if (!active) {
        if (currentState == EngineState.IDLE || currentState == EngineState.ERROR) {
          PoseCameraSession.stop {
            promise.resolve(null)
          }
        } else {
          promise.resolve(null)
        }
        return@execute
      }

      if (currentState != EngineState.IDLE && currentState != EngineState.ERROR) {
        promise.resolve(null)
        return@execute
      }

      val activity = currentActivityOrNull()
      if (activity == null) {
        promise.reject(ERROR_START, "Preview start failed: no active activity.")
        return@execute
      }

      PoseCameraSession.start(
        reactApplicationContext,
        activity,
        PoseCameraSession.Config(
          lensFacing = CameraSelector.LENS_FACING_BACK,
          fps = lastTargetFps,
        ),
        onFrame = null,
        onError = { message ->
          sendStatus("camera_error", mapOf("message" to message))
        },
      ) { error ->
        if (error != null) {
          promise.reject(ERROR_START, "Preview start failed: ${error.message}", error)
        } else {
          promise.resolve(null)
        }
      }
    }
  }

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise) {
    moduleExecutor.execute {
      val currentState = synchronized(stateLock) { state }
      if (currentState == EngineState.RUNNING || currentState == EngineState.STARTING) {
        promise.resolve(null)
        return@execute
      }

      if (!hasCameraPermission()) {
        synchronized(stateLock) {
          state = EngineState.ERROR
        }
        sendStatus("error_camera_permission_denied")
        promise.reject(ERROR_CAMERA_PERMISSION, "Camera permission denied")
        return@execute
      }

      val requestedModel = options.getOptionalString("model") ?: "full"
      val poseModelName = resolvePoseModelName(requestedModel)
      val trackingProfileRaw = options.getOptionalString("trackingProfile") ?: "auto"
      val trackingProfile =
        PoseLandmarkerRunner.TrackingProfileRequest.fromValue(trackingProfileRaw)
          ?: PoseLandmarkerRunner.TrackingProfileRequest.AUTO

      val minConfidence = options.getOptionalDouble("minConfidence") ?: 0.5
      val minPoseConfidence = options.getOptionalDouble("minPoseConfidence") ?: minConfidence
      val minFaceConfidence = options.getOptionalDouble("minFaceConfidence") ?: minConfidence
      val minHandConfidence = options.getOptionalDouble("minHandConfidence") ?: minConfidence
      val outputFaceBlendshapes = options.getOptionalBoolean("outputFaceBlendshapes") ?: true
      val outputPoseSegmentationMask =
        options.getOptionalBoolean("outputPoseSegmentationMask") ?: false

      val targetFps = maxOf(1, options.getOptionalInt("targetFps") ?: 30)
      val emitEveryNthFrame = maxOf(1, options.getOptionalInt("emitEveryNthFrame") ?: 1)
      val debug = options.getOptionalBoolean("debug") ?: false

      if (
        !inZeroToOne(minConfidence) ||
        !inZeroToOne(minPoseConfidence) ||
        !inZeroToOne(minFaceConfidence) ||
        !inZeroToOne(minHandConfidence)
      ) {
        synchronized(stateLock) {
          state = EngineState.ERROR
        }
        sendStatus("error_invalid_options")
        promise.reject(ERROR_OPTIONS, "Confidence values must be between 0 and 1")
        return@execute
      }

      val activity = currentActivityOrNull()
      if (activity == null) {
        synchronized(stateLock) {
          state = EngineState.ERROR
        }
        sendStatus("error_start_failed", mapOf("message" to "No active activity."))
        promise.reject(ERROR_START, "Camera start failed: no active activity.")
        return@execute
      }

      val mySession = synchronized(stateLock) {
        state = EngineState.STARTING
        sessionId += 1
        inputFrameCounter = 0
        lastEmitEveryNthFrame = emitEveryNthFrame
        lastTargetFps = targetFps
        sessionId
      }

      val runnerInstance = runner ?: PoseLandmarkerRunner(reactApplicationContext).also {
        runner = it
      }

      val runnerConfig =
        PoseLandmarkerRunner.Config(
          poseModelName = poseModelName,
          holisticModelName = "holistic_landmarker",
          trackingProfile = trackingProfile,
          minPoseConfidence = minPoseConfidence.toFloat(),
          minTrackingConfidence = minConfidence.toFloat(),
          minPresenceConfidence = minConfidence.toFloat(),
          minFaceConfidence = minFaceConfidence.toFloat(),
          minHandConfidence = minHandConfidence.toFloat(),
          outputFaceBlendshapes = outputFaceBlendshapes,
          outputPoseSegmentationMasks = outputPoseSegmentationMask,
          numPoses = 1,
          usesCpu = true,
          debug = debug,
        )

      sendStatus(
        "starting",
        mapOf(
          "requestedModel" to requestedModel,
          "model" to poseModelName,
          "requestedTrackingProfile" to trackingProfileRaw,
          "targetFps" to targetFps,
          "emitEveryNthFrame" to emitEveryNthFrame,
        ),
      )

      PoseCameraSession.start(
        reactApplicationContext,
        activity,
        PoseCameraSession.Config(
          lensFacing = CameraSelector.LENS_FACING_BACK,
          fps = targetFps,
        ),
        onFrame = { frame ->
          inferenceExecutor.execute {
            val shouldProcess = synchronized(stateLock) {
              if (sessionId != mySession || state != EngineState.RUNNING) {
                false
              } else {
                inputFrameCounter += 1
                (inputFrameCounter % emitEveryNthFrame) == 0
              }
            }

            if (!shouldProcess) {
              frame.imageProxy.close()
              return@execute
            }

            runnerInstance.process(frame.imageProxy)
          }
        },
        onError = { message ->
          val shouldEmit = synchronized(stateLock) { sessionId == mySession }
          if (shouldEmit) {
            sendStatus("camera_error", mapOf("message" to message))
          }
        },
      ) cameraCompletion@{ cameraError ->
        if (cameraError != null) {
          synchronized(stateLock) {
            if (sessionId == mySession) {
              state = EngineState.ERROR
            }
          }
          sendStatus("error_start_failed", mapOf("message" to (cameraError.message ?: "Unknown error")))
          promise.reject(ERROR_START, "Camera start failed: ${cameraError.message}", cameraError)
          return@cameraCompletion
        }

        try {
          runnerInstance.start(
            config = runnerConfig,
            onOutput = { payload ->
              moduleExecutor.execute {
                val shouldEmit = synchronized(stateLock) {
                  sessionId == mySession && state == EngineState.RUNNING && hasListeners
                }
                if (shouldEmit) {
                  emitFrame(payload)
                }
              }
            },
            onError = { message ->
              moduleExecutor.execute {
                val shouldEmit = synchronized(stateLock) { sessionId == mySession }
                if (shouldEmit) {
                  sendStatus("runner_error", mapOf("message" to message))
                }
              }
            },
          )
        } catch (error: Throwable) {
          if (previewActive) {
              PoseCameraSession.setCallbacks(
              reactApplicationContext,
              currentActivityOrNull(),
              onFrame = null,
              onError = null,
            )
          } else {
            PoseCameraSession.stop()
          }

          synchronized(stateLock) {
            if (sessionId == mySession) {
              state = EngineState.ERROR
            }
          }
          sendStatus("error_runner_start", mapOf("message" to (error.message ?: error.toString())))
          promise.reject(ERROR_START, "Runner start failed: ${error.message}", error)
          return@cameraCompletion
        }

        synchronized(stateLock) {
          if (sessionId == mySession) {
            state = EngineState.RUNNING
          }
        }

        sendStatus(
          "running",
          mapOf(
            "model" to poseModelName,
            "requestedModel" to requestedModel,
            "requestedTrackingProfile" to trackingProfileRaw,
            "targetFps" to targetFps,
            "emitEveryNthFrame" to emitEveryNthFrame,
          ),
        )
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    moduleExecutor.execute {
      val currentState = synchronized(stateLock) { state }
      if (currentState == EngineState.IDLE || currentState == EngineState.STOPPING) {
        promise.resolve(null)
        return@execute
      }

      val mySession = synchronized(stateLock) {
        state = EngineState.STOPPING
        sessionId += 1
        sessionId
      }
      sendStatus("stopping")

      try {
        runner?.stop()
      } catch (error: Throwable) {
        promise.reject(ERROR_STOP, "Runner stop failed: ${error.message}", error)
        return@execute
      }

      val finishStop = {
        synchronized(stateLock) {
          if (sessionId == mySession) {
            state = EngineState.IDLE
          }
        }
        sendStatus("idle")
        promise.resolve(null)
      }

      val activity = currentActivityOrNull()
      if (previewActive && activity != null) {
        PoseCameraSession.setCallbacks(
          reactApplicationContext,
          activity,
          onFrame = null,
          onError = null,
        ) { error ->
          if (error != null) {
            promise.reject(ERROR_STOP, "Preview stop failed: ${error.message}", error)
          } else {
            finishStop()
          }
        }
      } else {
        PoseCameraSession.stop {
          finishStop()
        }
      }
    }
  }

  override fun invalidate() {
    runner?.stop()
    PoseCameraSession.stop()
    moduleExecutor.shutdownNow()
    inferenceExecutor.shutdownNow()
    super.invalidate()
  }

  private fun hasCameraPermission(): Boolean {
    return ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.CAMERA,
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun currentActivityOrNull(): Activity? = reactApplicationContext.currentActivity

  private fun resolvePoseModelName(requestedModel: String): String {
    val preferred = if (requestedModel == "lite") "pose_landmarker_lite" else "pose_landmarker_full"
    if (bundledModelExists(preferred)) {
      return preferred
    }

    val fallback = if (requestedModel == "lite") "pose_landmarker_full" else "pose_landmarker_lite"
    if (bundledModelExists(fallback)) {
      return fallback
    }

    return preferred
  }

  private fun bundledModelExists(name: String, ext: String = "task"): Boolean {
    val fileName = "$name.$ext"
    return try {
      reactApplicationContext.assets.open(fileName).use { true }
    } catch (_: Exception) {
      false
    }
  }

  private fun emitFrame(payload: PoseLandmarkerRunner.FramePayload) {
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_FRAME, payload.toWritableMap())
  }

  private fun sendStatus(
    status: String,
    extra: Map<String, Any?> = emptyMap(),
  ) {
    val shouldEmit = synchronized(stateLock) { hasListeners }
    if (!shouldEmit) {
      return
    }

    val payload = Arguments.createMap()
    payload.putString("status", status)
    payload.putString("engineState", synchronized(stateLock) { state.value })

    extra["message"]?.let { payload.putString("message", it as String) }
    extra["model"]?.let { payload.putString("model", it as String) }
    extra["requestedModel"]?.let { payload.putString("requestedModel", it as String) }
    extra["requestedTrackingProfile"]?.let {
      payload.putString("requestedTrackingProfile", it as String)
    }
    extra["targetFps"]?.let { payload.putInt("targetFps", it as Int) }
    extra["emitEveryNthFrame"]?.let { payload.putInt("emitEveryNthFrame", it as Int) }

    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_STATUS, payload)
  }

  private fun inZeroToOne(value: Double): Boolean = value in 0.0..1.0

  private fun ReadableMap.getOptionalString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

  private fun ReadableMap.getOptionalBoolean(key: String): Boolean? =
    if (hasKey(key) && !isNull(key)) getBoolean(key) else null

  private fun ReadableMap.getOptionalDouble(key: String): Double? =
    if (hasKey(key) && !isNull(key)) getDouble(key) else null

  private fun ReadableMap.getOptionalInt(key: String): Int? =
    if (hasKey(key) && !isNull(key)) getInt(key) else null
}
