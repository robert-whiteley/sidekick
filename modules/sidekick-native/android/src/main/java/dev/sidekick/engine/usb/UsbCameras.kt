package dev.sidekick.engine.usb

import android.content.Context
import android.hardware.usb.UsbDevice
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.serenegiant.usb.USBMonitor

/**
 * Watches for USB cameras. Emits "onUsbCamera" {kind:'usbCamera', attached, name, permission}
 * on plug/unplug/permission; `open()` asks Android for permission (one system dialog, remembered
 * when the user ticks "always") and then hands the live FrameSource to `onOpen`.
 *
 * Android needs the CAMERA permission granted before it lets an app use a USB camera.
 */
object UsbCameras {
  @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null

  /** The camera pipeline sets this to receive the USB camera once it's open (null on unplug). */
  @Volatile var onSource: ((FrameSource?) -> Unit)? = null

  /** Requested mode (Settings → Camera & audio). */
  @Volatile var width = 1280
  @Volatile var height = 720
  @Volatile var fps = 10

  private var monitor: USBMonitor? = null

  /** Use a USB camera whenever one is plugged in (the recommended default); off = phone camera. */
  @Volatile var wanted = true
  @Volatile var source: UvcFrameSource? = null
    private set
  @Volatile private var sourceDevice: String? = null

  private val main = Handler(Looper.getMainLooper())

  private fun isCamera(d: UsbDevice): Boolean =
    d.deviceClass == UvcLogic.USB_CLASS_VIDEO ||
      UvcLogic.isCamera((0 until d.interfaceCount).map { d.getInterface(it).interfaceClass })

  private fun name(d: UsbDevice) = UvcLogic.displayName(d.productName, d.manufacturerName)

  private fun emit(d: UsbDevice?, attached: Boolean, permission: Boolean?) {
    listener?.invoke(
      "onUsbCamera",
      mapOf("kind" to "usbCamera", "attached" to attached, "name" to (d?.let(::name) ?: "USB camera"), "permission" to permission),
    )
  }

  private val events =
    object : USBMonitor.OnDeviceConnectListener {
      override fun onAttach(device: UsbDevice) {
        if (!isCamera(device)) return
        val allowed = monitor?.hasPermission(device)
        Log.i(TAG, "USB camera plugged in (permission $allowed, wanted $wanted)")
        emit(device, true, allowed)
        if (wanted) monitor?.requestPermission(device)
      }

      override fun onDetach(device: UsbDevice) {
        // The held camera always closes (a detached device may no longer list its interfaces).
        if (device.deviceName == sourceDevice) close() else if (!isCamera(device)) return
        Log.i(TAG, "USB camera unplugged")
        emit(device, false, null)
      }

      override fun onDeviceOpen(device: UsbDevice, block: USBMonitor.UsbControlBlock, createNew: Boolean) {
        if (!isCamera(device)) return
        if (source != null && !UvcLogic.replaceOnOpen(sourceDevice, device.deviceName)) return
        Log.i(TAG, "USB camera opened")
        source?.let { old ->
          source = null
          old.stop()
        }
        val src = UvcFrameSource(block, width, height, fps)
        source = src
        sourceDevice = device.deviceName
        emit(device, true, true)
        onSource?.invoke(src)
      }

      override fun onDeviceClose(device: UsbDevice, block: USBMonitor.UsbControlBlock) {
        if (device.deviceName == sourceDevice) close()
      }

      override fun onCancel(device: UsbDevice) {
        if (isCamera(device)) emit(device, true, false)
      }

      override fun onError(device: UsbDevice, e: USBMonitor.USBException) {
        Log.w(TAG, "USB camera error", e)
        if (isCamera(device)) emit(device, true, false)
      }
    }

  /** Start watching (cheap: a broadcast receiver plus a 1 s device check while registered). */
  @Synchronized
  fun watch(ctx: Context) {
    if (monitor != null) return
    monitor = USBMonitor(ctx.applicationContext, events, main).also { it.register() }
  }

  @Synchronized
  fun unwatch() {
    close()
    monitor?.run {
      unregister()
      destroy()
    }
    monitor = null
  }

  /** Connected USB cameras: [{name, permission}]. */
  fun list(ctx: Context): List<Map<String, Any?>> {
    watch(ctx)
    val m = monitor ?: return emptyList()
    return m.deviceList.filter(::isCamera).map { mapOf("name" to name(it), "permission" to m.hasPermission(it)) }
  }

  /** Use the first connected USB camera: asks permission if needed, then `onSource` fires. */
  fun open(ctx: Context): Boolean {
    watch(ctx)
    wanted = true
    val m = monitor ?: return false
    val cam = m.deviceList.firstOrNull(::isCamera) ?: return false
    m.requestPermission(cam)
    return true
  }

  /** The user chose the phone camera: stop and don't reopen on the next plug-in. */
  fun usePhoneCamera() {
    wanted = false
    close()
  }

  /** Stop the USB camera (the pipeline falls back to the phone camera). */
  @Synchronized
  fun close() {
    val src = source ?: return
    source = null
    sourceDevice = null
    src.stop()
    onSource?.invoke(null)
  }

  private const val TAG = "SidekickUsb"
}
