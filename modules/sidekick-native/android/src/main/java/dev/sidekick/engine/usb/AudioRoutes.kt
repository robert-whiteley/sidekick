package dev.sidekick.engine.usb

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.lang.ref.WeakReference

/**
 * Audio inputs and outputs: lists them, picks the best connected one (AudioRouteLogic), applies
 * it to Sidekick's recorder and player, and follows plug/unplug. Settings can pin a choice by key.
 */
object AudioRoutes {
  /** Called with "onAudioDevices" when inputs/outputs change. */
  @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null

  @Volatile var inputOverride: String? = null
  @Volatile var outputOverride: String? = null

  /** True while a button-press ask is running (allows the Bluetooth mic). */
  @Volatile var asking = false

  private var am: AudioManager? = null
  private var recorder = WeakReference<AudioRecord>(null)
  private var player = WeakReference<AudioTrack>(null)
  private var commDevice = false

  private val callback =
    object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = changed()

      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = changed()
    }

  fun init(ctx: Context) {
    if (am != null) return
    val manager = ctx.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    am = manager
    manager.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper()))
  }

  fun ports(): List<AudioPort> {
    val manager = am ?: return emptyList()
    val ins =
      manager.getDevices(AudioManager.GET_DEVICES_INPUTS).mapNotNull { d ->
        AudioRouteLogic.inputKind(d.type)?.let { AudioPort(d.id, it, label(d, it), true) }
      }
    val outs =
      manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).mapNotNull { d ->
        AudioRouteLogic.outputKind(d.type)?.let { AudioPort(d.id, it, label(d, it), false) }
      }
    return AudioRouteLogic.dedupe(ins + outs)
  }

  private fun label(d: AudioDeviceInfo, kind: String): String {
    val name = d.productName?.toString()?.trim().orEmpty()
    // Built-in devices report the phone model; plain words read better.
    if (kind == "phone") return if (d.isSource) "Phone mic" else "Phone speaker"
    return name.ifEmpty {
      when (kind) {
        "usb" -> "USB audio"
        "wired" -> "Headphones"
        else -> "Bluetooth"
      }
    }
  }

  /** Headphones (wired, USB headset or Bluetooth) are connected for output. */
  fun headphonesOn(): Boolean =
    ports().any { !it.input && (it.kind == "wired" || it.kind == "bluetooth" || (it.kind == "usb" && it.name != "USB audio")) }

  fun chosenInput(): AudioPort? = AudioRouteLogic.choose(ports(), input = true, forAsk = asking, override = inputOverride)

  fun chosenOutput(): AudioPort? = AudioRouteLogic.choose(ports(), input = false, forAsk = false, override = outputOverride)

  private fun device(port: AudioPort?, flag: Int): AudioDeviceInfo? =
    port?.let { p -> am?.getDevices(flag)?.firstOrNull { it.id == p.id } }

  /** MicLoop calls this right after creating its recorder (and it is re-applied on changes). */
  fun applyInput(rec: AudioRecord) {
    recorder = WeakReference(rec)
    val port = chosenInput()
    val dev = device(port, AudioManager.GET_DEVICES_INPUTS)
    // A Bluetooth headset mic only works over the call link: route it (Android 12+), else skip.
    setBluetoothCall(port?.kind == "bluetooth")
    runCatching { rec.setPreferredDevice(dev) }
  }

  /** The voice player calls this when it creates its track. */
  fun applyOutput(track: AudioTrack) {
    player = WeakReference(track)
    runCatching { track.setPreferredDevice(device(chosenOutput(), AudioManager.GET_DEVICES_OUTPUTS)) }
  }

  @SuppressLint("NewApi")
  private fun setBluetoothCall(on: Boolean) {
    val manager = am ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    if (on) {
      val bt =
        manager.availableCommunicationDevices.firstOrNull {
          it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
        }
      if (bt != null) commDevice = manager.setCommunicationDevice(bt)
    } else if (commDevice) {
      manager.clearCommunicationDevice()
      commDevice = false
    }
  }

  /** A button-press ask starts: the Bluetooth headset mic becomes eligible. */
  fun beginAsk() {
    asking = true
    recorder.get()?.let { applyInput(it) }
  }

  /** Ends a button-press ask: back to the listening input, Bluetooth call link released. */
  fun endAsk() {
    asking = false
    recorder.get()?.let { applyInput(it) } ?: setBluetoothCall(false)
  }

  private fun changed() {
    recorder.get()?.let { applyInput(it) }
    player.get()?.let { applyOutput(it) }
    listener?.invoke("onAudioDevices", snapshot())
  }

  fun snapshot(): Map<String, Any?> {
    val all = ports()
    fun row(p: AudioPort) = mapOf("id" to p.id, "key" to p.key, "kind" to p.kind, "name" to p.name)
    return mapOf(
      "inputs" to all.filter { it.input }.map(::row),
      "outputs" to all.filter { !it.input }.map(::row),
      "input" to chosenInput()?.key,
      "output" to chosenOutput()?.key,
      "recommendedInput" to AudioRouteLogic.recommended(all, input = true, forAsk = false)?.key,
      "recommendedOutput" to AudioRouteLogic.recommended(all, input = false, forAsk = false)?.key,
    )
  }

  /**
   * Can this phone record two inputs at once (headset mic for commands + camera mic for the
   * conversation)? Opens both for ~0.4 s and checks each is routed where asked and delivers sound.
   * Call with Listen off (the probe is a second and third recorder otherwise).
   */
  @SuppressLint("MissingPermission")
  fun probeSplit(): Map<String, Any?> {
    val all = ports()
    val usb = all.firstOrNull { it.input && it.kind == "usb" }
    val other = all.firstOrNull { it.input && (it.kind == "wired" || it.kind == "bluetooth") }
      ?: all.firstOrNull { it.input && it.kind == "phone" }
    if (usb == null || other == null) {
      return mapOf("possible" to false, "tested" to false, "reason" to "needs a USB mic and a second mic connected")
    }
    val rate = 16_000
    val buf = maxOf(AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), rate)
    fun open(p: AudioPort): AudioRecord? =
      runCatching {
          AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, buf)
            .also { it.setPreferredDevice(device(p, AudioManager.GET_DEVICES_INPUTS)) }
        }
        .getOrNull()
    val a = open(usb)
    val b = open(other)
    try {
      if (a == null || b == null || a.state != AudioRecord.STATE_INITIALIZED || b.state != AudioRecord.STATE_INITIALIZED) {
        return mapOf("possible" to false, "tested" to true, "reason" to "second recorder could not open")
      }
      a.startRecording()
      b.startRecording()
      val chunk = ShortArray(rate / 10)
      var readA = 0
      var readB = 0
      repeat(4) {
        readA += a.read(chunk, 0, chunk.size).coerceAtLeast(0)
        readB += b.read(chunk, 0, chunk.size).coerceAtLeast(0)
      }
      val routedA = a.routedDevice?.id == usb.id
      val routedB = b.routedDevice?.id == other.id
      val ok = routedA && routedB && readA > 0 && readB > 0 && a.recordingState == AudioRecord.RECORDSTATE_RECORDING &&
        b.recordingState == AudioRecord.RECORDSTATE_RECORDING
      return mapOf(
        "possible" to ok,
        "tested" to true,
        "reason" to if (ok) "both inputs recorded" else "phone recorded one input only (routedUsb=$routedA routedOther=$routedB)",
        "inputs" to listOf(usb.key, other.key),
      )
    } finally {
      runCatching { a?.stop() }
      runCatching { b?.stop() }
      a?.release()
      b?.release()
    }
  }
}
