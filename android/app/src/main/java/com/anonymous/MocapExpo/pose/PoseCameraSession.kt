package com.anonymous.MocapExpo.pose

import android.app.Activity
import android.content.Context
import android.hardware.camera2.CaptureRequest
import android.util.Range
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

object PoseCameraSession {

  data class Config(
    val lensFacing: Int = CameraSelector.LENS_FACING_BACK,
    val fps: Int = 30,
  )

  data class FrameInfo(
    val imageProxy: ImageProxy,
  )

  typealias FrameCallback = (FrameInfo) -> Unit
  typealias ErrorCallback = (String) -> Unit

  private val lock = Any()
  private val analyzerExecutor = Executors.newSingleThreadExecutor()

  private var appContext: Context? = null
  private var previewViewRef = WeakReference<PreviewView?>(null)
  private var lastActivityRef = WeakReference<Activity?>(null)

  private var cameraProvider: ProcessCameraProvider? = null
  private var previewUseCase: Preview? = null
  private var analysisUseCase: ImageAnalysis? = null

  private var isRunning = false
  private var config: Config? = null
  private var onFrame: FrameCallback? = null
  private var onError: ErrorCallback? = null

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
    onFrame: FrameCallback?,
    onError: ErrorCallback?,
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
    onFrame: FrameCallback?,
    onError: ErrorCallback?,
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
        analysisUseCase?.clearAnalyzer()
        cameraProvider?.unbindAll()
        clearStateLocked()
      }
      completion?.invoke()
    }
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
      isRunning = true
    }
  }

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
  }
}
