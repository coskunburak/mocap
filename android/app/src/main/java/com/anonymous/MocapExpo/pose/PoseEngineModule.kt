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
    const val EVENT_STATUS = "PoseEngineStatus"

    const val ERROR_CAMERA_PERMISSION = "E_CAMERA_PERMISSION"
    const val ERROR_START = "E_START"
    const val ERROR_STOP = "E_STOP"
    const val ERROR_OPTIONS = "E_OPTIONS"
    const val ERROR_VIDEO_RECORDING = "E_VIDEO_RECORDING"
  }

  private enum class EngineState(val value: String) {
    IDLE("idle"),
    STARTING("starting"),
    RUNNING("running"),
    STOPPING("stopping"),
    ERROR("error"),
  }

  private val moduleExecutor = Executors.newSingleThreadExecutor()
  private val stateLock = Any()

  private var state = EngineState.IDLE
  private var hasListeners = false
  private var listenerCount = 0
  private var lastTargetFps = 30

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
    result.putString("version", "camera-android-wham-upload-v1")
    result.putString("pipeline", "wham_video_upload")
    promise.resolve(result)
  }

  @ReactMethod
  fun setPreviewActive(active: Boolean, promise: Promise) {
    moduleExecutor.execute {
      if (!active) {
        synchronized(stateLock) {
          state = EngineState.STOPPING
        }
        sendStatus("stopping")
        PoseCameraSession.stop {
          synchronized(stateLock) {
            state = EngineState.IDLE
          }
          sendStatus("idle")
          promise.resolve(null)
        }
        return@execute
      }

      startCamera(lastTargetFps, promise)
    }
  }

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise) {
    moduleExecutor.execute {
      lastTargetFps = maxOf(1, options.getOptionalInt("targetFps") ?: lastTargetFps)
      startCamera(lastTargetFps, promise)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    moduleExecutor.execute {
      synchronized(stateLock) {
        state = EngineState.STOPPING
      }
      sendStatus("stopping")
      PoseCameraSession.stop {
        synchronized(stateLock) {
          state = EngineState.IDLE
        }
        sendStatus("idle")
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun startVideoRecording(options: ReadableMap, promise: Promise) {
    moduleExecutor.execute {
      val takeId = options.getOptionalString("takeId")
      if (takeId.isNullOrBlank()) {
        promise.reject(ERROR_OPTIONS, "takeId is required")
        return@execute
      }

      val fps = maxOf(1, options.getOptionalInt("fps") ?: lastTargetFps)
      lastTargetFps = fps
      val activity = currentActivityOrNull()
      if (activity == null) {
        promise.reject(ERROR_START, "Video recording failed: no active activity.")
        return@execute
      }

      if (!hasCameraPermission()) {
        promise.reject(ERROR_CAMERA_PERMISSION, "Camera permission denied")
        return@execute
      }

      PoseCameraSession.startRecording(
        reactApplicationContext,
        activity,
        PoseCameraSession.RecordingOptions(
          takeId = takeId,
          fps = fps,
        ),
      ) { error ->
        if (error != null) {
          sendStatus("video_recording_error", mapOf("message" to (error.message ?: error.toString())))
          promise.reject(
            ERROR_VIDEO_RECORDING,
            "Video recording failed to start: ${error.message}",
            error,
          )
        } else {
          synchronized(stateLock) {
            state = EngineState.RUNNING
          }
          sendStatus("video_recording_started")
          promise.resolve(null)
        }
      }
    }
  }

  @ReactMethod
  fun stopVideoRecording(promise: Promise) {
    moduleExecutor.execute {
      PoseCameraSession.stopRecording { result, error ->
        if (error != null) {
          sendStatus("video_recording_error", mapOf("message" to (error.message ?: error.toString())))
          promise.reject(
            ERROR_VIDEO_RECORDING,
            "Video recording failed to stop: ${error.message}",
            error,
          )
          return@stopRecording
        }

        if (result == null) {
          promise.reject(ERROR_VIDEO_RECORDING, "Video recording returned no result")
          return@stopRecording
        }

        sendStatus("video_recording_stopped")
        promise.resolve(result.toWritableMap())
      }
    }
  }

  override fun invalidate() {
    PoseCameraSession.stop()
    moduleExecutor.shutdownNow()
    super.invalidate()
  }

  private fun startCamera(targetFps: Int, promise: Promise) {
    if (!hasCameraPermission()) {
      synchronized(stateLock) {
        state = EngineState.ERROR
      }
      sendStatus("error_camera_permission_denied")
      promise.reject(ERROR_CAMERA_PERMISSION, "Camera permission denied")
      return
    }

    val activity = currentActivityOrNull()
    if (activity == null) {
      synchronized(stateLock) {
        state = EngineState.ERROR
      }
      sendStatus("error_start_failed", mapOf("message" to "No active activity."))
      promise.reject(ERROR_START, "Camera start failed: no active activity.")
      return
    }

    synchronized(stateLock) {
      state = EngineState.STARTING
    }
    sendStatus("starting", mapOf("targetFps" to targetFps))
    PoseCameraSession.start(
      reactApplicationContext,
      activity,
      PoseCameraSession.Config(
        lensFacing = CameraSelector.LENS_FACING_BACK,
        fps = targetFps,
      ),
      onFrame = null,
      onError = { message ->
        sendStatus("camera_error", mapOf("message" to message))
      },
    ) { error ->
      if (error != null) {
        synchronized(stateLock) {
          state = EngineState.ERROR
        }
        sendStatus("error_start_failed", mapOf("message" to (error.message ?: "Unknown error")))
        promise.reject(ERROR_START, "Camera start failed: ${error.message}", error)
        return@start
      }

      synchronized(stateLock) {
        state = EngineState.RUNNING
      }
      sendStatus("running", mapOf("pipeline" to "wham_video_upload", "targetFps" to targetFps))
      promise.resolve(null)
    }
  }

  private fun hasCameraPermission(): Boolean {
    return ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.CAMERA,
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun currentActivityOrNull(): Activity? = reactApplicationContext.currentActivity

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
    extra["pipeline"]?.let { payload.putString("pipeline", it as String) }
    extra["targetFps"]?.let { payload.putInt("targetFps", it as Int) }

    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_STATUS, payload)
  }

  private fun ReadableMap.getOptionalString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

  private fun ReadableMap.getOptionalInt(key: String): Int? =
    if (hasKey(key) && !isNull(key)) getInt(key) else null
}
