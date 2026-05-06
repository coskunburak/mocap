package com.anonymous.MocapExpo.pose

import android.app.Activity
import android.content.Context
import android.hardware.camera2.CaptureRequest
import android.media.MediaMetadataRetriever
import android.util.Range
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.lang.ref.WeakReference
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

typealias PoseFrameCallback = (PoseCameraSession.FrameInfo) -> Unit
typealias PoseErrorCallback = (String) -> Unit

object PoseCameraSession {

  data class Config(
    val lensFacing: Int = CameraSelector.LENS_FACING_BACK,
    val fps: Int = 30,
  )

  data class FrameInfo(
    val imageProxy: ImageProxy,
  )

  data class RecordingOptions(
    val takeId: String,
    val fps: Int = 30,
  )

  data class RecordingResult(
    val takeId: String,
    val localUri: String,
    val startedAt: String,
    val endedAt: String,
    val durationMs: Double,
    val fps: Double,
    val width: Int,
    val height: Int,
    val fileSizeBytes: Long,
    val codec: String,
    val container: String,
  ) {
    fun toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putString("takeId", takeId)
        putString("localUri", localUri)
        putString("startedAt", startedAt)
        putString("endedAt", endedAt)
        putDouble("durationMs", durationMs)
        putDouble("fps", fps)
        putInt("width", width)
        putInt("height", height)
        putDouble("fileSizeBytes", fileSizeBytes.toDouble())
        putString("codec", codec)
        putString("container", container)
        putString("platform", "android")
      }
    }
  }

  private enum class RecordingState {
    IDLE,
    PREPARING,
    RECORDING,
    STOPPING,
    FAILED,
  }

  private val lock = Any()
  private val analyzerExecutor = Executors.newSingleThreadExecutor()

  private var appContext: Context? = null
  private var previewViewRef = WeakReference<PreviewView?>(null)
  private var lastActivityRef = WeakReference<Activity?>(null)

  private var cameraProvider: ProcessCameraProvider? = null
  private var previewUseCase: Preview? = null
  private var analysisUseCase: ImageAnalysis? = null
  private var videoCaptureUseCase: VideoCapture<Recorder>? = null

  private var isRunning = false
  private var config: Config? = null
  private var onFrame: PoseFrameCallback? = null
  private var onError: PoseErrorCallback? = null

  private var recordingState = RecordingState.IDLE
  private var activeRecording: Recording? = null
  private var recordingOptions: RecordingOptions? = null
  private var recordingFile: File? = null
  private var recordingStartedAtMs = 0L
  private var recordingCompletion: ((RecordingResult?, Throwable?) -> Unit)? = null

  fun attachPreviewView(view: PreviewView?) {
    val context = view?.context?.applicationContext ?: synchronized(lock) { appContext }

    synchronized(lock) {
      if (context != null) {
        appContext = context
      }
      previewViewRef = WeakReference(view)
    }

    val executorContext = context ?: return
    ContextCompat.getMainExecutor(executorContext).execute {
      synchronized(lock) {
        previewUseCase?.surfaceProvider = view?.surfaceProvider
      }
    }
  }

  fun start(
    context: Context,
    activity: Activity,
    config: Config,
    onFrame: PoseFrameCallback?,
    onError: PoseErrorCallback?,
    completion: (Throwable?) -> Unit,
  ) {
    val wantsAnalysis = onFrame != null
    val shouldRebind = synchronized(lock) {
      appContext = context.applicationContext
      lastActivityRef = WeakReference(activity)

      val previousConfig = this.config
      val previousWantsAnalysis = this.onFrame != null

      this.config = config
      this.onFrame = onFrame
      this.onError = onError

      !isRunning || previousConfig != config || previousWantsAnalysis != wantsAnalysis
    }

    if (!shouldRebind) {
      completion(null)
      return
    }

    rebind(activity, completion)
  }

  fun setCallbacks(
    context: Context,
    activity: Activity?,
    onFrame: PoseFrameCallback?,
    onError: PoseErrorCallback?,
    completion: ((Throwable?) -> Unit)? = null,
  ) {
    val owner = activity ?: synchronized(lock) { lastActivityRef.get() }
    val shouldRebind = synchronized(lock) {
      appContext = context.applicationContext
      if (activity != null) {
        lastActivityRef = WeakReference(activity)
      }

      val previousWantsAnalysis = this.onFrame != null
      val nextWantsAnalysis = onFrame != null

      this.onFrame = onFrame
      this.onError = onError

      isRunning && previousWantsAnalysis != nextWantsAnalysis && owner != null
    }

    if (!shouldRebind || owner == null) {
      completion?.invoke(null)
      return
    }

    rebind(owner, completion ?: {})
  }

  fun stop(completion: (() -> Unit)? = null) {
    val context = synchronized(lock) { appContext }
    if (context == null) {
      synchronized(lock) {
        clearStateLocked()
      }
      completion?.invoke()
      return
    }

    ContextCompat.getMainExecutor(context).execute {
      synchronized(lock) {
        activeRecording?.stop()
        analysisUseCase?.clearAnalyzer()
        cameraProvider?.unbindAll()
        clearStateLocked()
      }
      completion?.invoke()
    }
  }

  fun startRecording(
    context: Context,
    activity: Activity?,
    options: RecordingOptions,
    completion: (Throwable?) -> Unit,
  ) {
    val owner = activity ?: synchronized(lock) { lastActivityRef.get() }
    if (owner == null) {
      completion(IllegalStateException("Active activity is required to record video."))
      return
    }

    val outputFile =
      try {
        createVideoFile(context, options.takeId)
      } catch (error: Throwable) {
        completion(error)
        return
      }

    val shouldRebind = synchronized(lock) {
      if (recordingState != RecordingState.IDLE && recordingState != RecordingState.FAILED) {
        completion(IllegalStateException("Video recorder is already active."))
        return
      }

      appContext = context.applicationContext
      lastActivityRef = WeakReference(owner)
      recordingState = RecordingState.PREPARING
      recordingOptions = options
      recordingFile = outputFile
      recordingStartedAtMs = System.currentTimeMillis()

      !isRunning || videoCaptureUseCase == null
    }

    val startAfterBind: (Throwable?) -> Unit = { error ->
      if (error != null) {
        synchronized(lock) {
          clearRecordingLocked()
          recordingState = RecordingState.FAILED
        }
        completion(error)
      } else {
        beginCameraXRecording(context.applicationContext, completion)
      }
    }

    if (shouldRebind) {
      rebind(owner, startAfterBind)
    } else {
      startAfterBind(null)
    }
  }

  fun stopRecording(completion: (RecordingResult?, Throwable?) -> Unit) {
    val recording = synchronized(lock) {
      val current = activeRecording
      if (recordingState != RecordingState.RECORDING || current == null) {
        completion(null, IllegalStateException("Video recorder is not recording."))
        return
      }

      recordingState = RecordingState.STOPPING
      recordingCompletion = completion
      current
    }

    recording.stop()
  }

  private fun rebind(
    activity: Activity,
    completion: (Throwable?) -> Unit,
  ) {
    val context = synchronized(lock) { appContext }
    val lifecycleOwner = activity as? LifecycleOwner

    if (context == null || lifecycleOwner == null) {
      completion(
        IllegalStateException("Active activity is required to bind CameraX use cases."),
      )
      return
    }

    val providerFuture = ProcessCameraProvider.getInstance(context)
    val mainExecutor = ContextCompat.getMainExecutor(context)

    providerFuture.addListener(
      {
        try {
          val provider = providerFuture.get()
          bindUseCases(provider, lifecycleOwner)
          completion(null)
        } catch (error: Throwable) {
          completion(error)
        }
      },
      mainExecutor,
    )
  }

  private fun bindUseCases(
    provider: ProcessCameraProvider,
    lifecycleOwner: LifecycleOwner,
  ) {
    val configSnapshot = synchronized(lock) {
      config ?: throw IllegalStateException("Camera config is missing.")
    }

    val fpsRange = Range(maxOf(1, configSnapshot.fps), maxOf(1, configSnapshot.fps))
    val previewBuilder = Preview.Builder()
    Camera2Interop.Extender(previewBuilder).setCaptureRequestOption(
      CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
      fpsRange,
    )

    val preview = previewBuilder.build()
    val previewView = synchronized(lock) { previewViewRef.get() }
    preview.surfaceProvider = previewView?.surfaceProvider

    val useCases = mutableListOf(preview as androidx.camera.core.UseCase)

    val wantsAnalysis = synchronized(lock) { onFrame != null }
    val analysis =
      if (wantsAnalysis) {
        val analysisBuilder =
          ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        Camera2Interop.Extender(analysisBuilder).setCaptureRequestOption(
          CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
          fpsRange,
        )

        analysisBuilder.build().also { useCase ->
          useCase.setAnalyzer(analyzerExecutor, ::handleImageProxy)
          useCases += useCase
        }
      } else {
        null
      }

    val wantsVideo = synchronized(lock) {
      recordingState == RecordingState.PREPARING ||
        recordingState == RecordingState.RECORDING ||
        recordingState == RecordingState.STOPPING
    }
    val videoCapture =
      if (wantsVideo) {
        val recorder =
          Recorder.Builder()
            .setQualitySelector(
              QualitySelector.from(
                Quality.HD,
                FallbackStrategy.lowerQualityOrHigherThan(Quality.SD),
              ),
            )
            .build()
        VideoCapture.withOutput(recorder).also { useCase ->
          useCases += useCase
        }
      } else {
        null
      }

    provider.unbindAll()
    provider.bindToLifecycle(
      lifecycleOwner,
      CameraSelector.Builder().requireLensFacing(configSnapshot.lensFacing).build(),
      *useCases.toTypedArray(),
    )

    synchronized(lock) {
      cameraProvider = provider
      previewUseCase = preview
      analysisUseCase = analysis
      videoCaptureUseCase = videoCapture
      isRunning = true
    }
  }

  private fun beginCameraXRecording(
    context: Context,
    completion: (Throwable?) -> Unit,
  ) {
    val snapshot = synchronized(lock) {
      Triple(videoCaptureUseCase, recordingFile, recordingOptions)
    }
    val videoCapture = snapshot.first
    val file = snapshot.second
    val options = snapshot.third

    if (videoCapture == null || file == null || options == null) {
      synchronized(lock) {
        clearRecordingLocked()
        recordingState = RecordingState.FAILED
      }
      completion(IllegalStateException("Camera video capture use case is not ready."))
      return
    }

    try {
      val outputOptions = FileOutputOptions.Builder(file).build()
      val recording =
        videoCapture.output
          .prepareRecording(context, outputOptions)
          .start(ContextCompat.getMainExecutor(context), ::handleVideoRecordEvent)

      synchronized(lock) {
        activeRecording = recording
        recordingState = RecordingState.RECORDING
      }
      completion(null)
    } catch (error: Throwable) {
      synchronized(lock) {
        clearRecordingLocked()
        recordingState = RecordingState.FAILED
      }
      completion(error)
    }
  }

  private fun handleVideoRecordEvent(event: VideoRecordEvent) {
    when (event) {
      is VideoRecordEvent.Start -> {
        synchronized(lock) {
          recordingState = RecordingState.RECORDING
        }
      }
      is VideoRecordEvent.Finalize -> {
        val snapshot = synchronized(lock) {
          val completion = recordingCompletion
          val file = recordingFile
          val options = recordingOptions
          val startedAtMs = recordingStartedAtMs
          clearRecordingLocked()
          recordingState = RecordingState.IDLE
          FinalizeSnapshot(completion, file, options, startedAtMs)
        }

        val completion = snapshot.completion ?: return
        if (event.hasError()) {
          completion(
            null,
            event.cause ?: RuntimeException("Video recording failed with error ${event.error}."),
          )
          return
        }

        val file = snapshot.file
        val options = snapshot.options
        if (file == null || options == null) {
          completion(null, IllegalStateException("Recording output is missing."))
          return
        }

        try {
          completion(readVideoResult(file, options, snapshot.startedAtMs), null)
        } catch (error: Throwable) {
          completion(null, error)
        }
      }
    }
  }

  private data class FinalizeSnapshot(
    val completion: ((RecordingResult?, Throwable?) -> Unit)?,
    val file: File?,
    val options: RecordingOptions?,
    val startedAtMs: Long,
  )

  private fun handleImageProxy(imageProxy: ImageProxy) {
    val frameCallback = synchronized(lock) { onFrame }
    if (frameCallback == null) {
      imageProxy.close()
      return
    }

    try {
      frameCallback(FrameInfo(imageProxy))
    } catch (error: Throwable) {
      imageProxy.close()
      val errorCallback = synchronized(lock) { onError }
      errorCallback?.invoke(error.message ?: "Camera frame callback failed.")
    }
  }

  private fun clearStateLocked() {
    isRunning = false
    config = null
    onFrame = null
    onError = null
    cameraProvider = null
    previewUseCase = null
    analysisUseCase = null
    videoCaptureUseCase = null
    clearRecordingLocked()
  }

  private fun clearRecordingLocked() {
    activeRecording = null
    recordingOptions = null
    recordingFile = null
    recordingStartedAtMs = 0L
    recordingCompletion = null
    if (recordingState != RecordingState.FAILED) {
      recordingState = RecordingState.IDLE
    }
  }

  private fun createVideoFile(context: Context, takeId: String): File {
    val directory = File(context.cacheDir, "mocap/videos")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("Could not create video directory.")
    }

    val safeTakeId = takeId.replace(Regex("[^A-Za-z0-9_-]"), "_")
    val file = File(directory, "$safeTakeId.mp4")
    if (file.exists() && !file.delete()) {
      throw IllegalStateException("Could not replace existing video file.")
    }
    return file
  }

  private fun readVideoResult(
    file: File,
    options: RecordingOptions,
    startedAtMs: Long,
  ): RecordingResult {
    val endedAtMs = System.currentTimeMillis()
    val retriever = MediaMetadataRetriever()
    var width = 0
    var height = 0
    var durationMs = (endedAtMs - startedAtMs).coerceAtLeast(0).toDouble()
    var fps = options.fps.toDouble()

    try {
      retriever.setDataSource(file.absolutePath)
      width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
        ?.toIntOrNull()
        ?: 0
      height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
        ?.toIntOrNull()
        ?: 0
      durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
        ?.toDoubleOrNull()
        ?: durationMs
      fps = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)
        ?.toDoubleOrNull()
        ?: fps
    } finally {
      retriever.release()
    }

    if (!file.exists() || file.length() <= 0L) {
      throw IllegalStateException("Recorded video is empty.")
    }

    return RecordingResult(
      takeId = options.takeId,
      localUri = file.toURI().toString(),
      startedAt = isoDate(startedAtMs),
      endedAt = isoDate(endedAtMs),
      durationMs = durationMs,
      fps = fps,
      width = width,
      height = height,
      fileSizeBytes = file.length(),
      codec = "h264",
      container = "mp4",
    )
  }

  private fun isoDate(timeMs: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date(timeMs))
  }
}
