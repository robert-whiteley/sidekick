package dev.sidekick.engine

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class LlmCandidateRecord : Record {
  @Field val modelPath: String = ""
  @Field val backend: String = "cpu"
}

class GenerateOptionsRecord : Record {
  @Field val maxTokens: Int? = null
  @Field val keepHistory: Boolean = false
  @Field val system: String? = null
  @Field val scratch: Boolean = false
  @Field val undoable: Boolean = false
  @Field val offRecord: Boolean = false
  @Field val thinkingBudget: Int? = null
  @Field val cacheSystem: Boolean = false
}

class LlmTuningRecord : Record {
  @Field val threads: Int? = null
  @Field val speculative: String? = null
  @Field val visualTokenBudget: Int? = null
  @Field val maxTokens: Int? = null
  @Field val maxImageEdge: Int? = null
}

class SidekickNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  private val prefs by lazy { context.getSharedPreferences("sidekick", Context.MODE_PRIVATE) }

  private val downloads by lazy { Downloads(context) }

  private val llm get() = Engines.llm(context)

  override fun definition() = ModuleDefinition {
    Name("SidekickNative")

    Events("onLlmText", "onWake", "onTranscript", "onPartialTranscript", "onQuestion", "onListenError", "onBargeIn", "onVoiceIdle", "onUsbCamera", "onAudioDevices", "onMediaButton", "onCamera", "onMemoryPressure", "onPicture")

    OnCreate {
      MicLoop.listener = { name, body -> sendEvent(name, body) }
      // Android's low-memory signals free the big models (they reload on demand); JS drops caches.
      appContext.reactContext?.let { MemoryWatch.install(it) }
      MemoryWatch.listener = { body -> sendEvent("onMemoryPressure", body) }
      Voice.onIdle = { sendEvent("onVoiceIdle", emptyMap<String, Any?>()) }
      dev.sidekick.engine.camera.LiveCapture.listener = { body -> sendEvent("onCamera", body) }
      // Inputs/outputs (engine/usb): USB camera plug/unplug, audio device changes, headset button.
      dev.sidekick.engine.usb.UsbCameras.listener = { name, body -> sendEvent(name, body) }
      dev.sidekick.engine.usb.AudioRoutes.listener = { name, body -> sendEvent(name, body) }
      dev.sidekick.engine.usb.MediaButtons.listener = { name, body -> sendEvent(name, body) }
      appContext.reactContext?.let { dev.sidekick.engine.usb.AudioRoutes.init(it) }
      // Measure Pocket once in the background (if downloaded and not yet decided).
      runCatching { Voice.decideSoon(context) }
    }

    // Entry points: phone assistant role, Quick Settings tile, home-screen widget (EntryPoints.kt).
    Function("assistantIsDefault") { EntryPoints.isDefaultAssistant(context) }
    Function("openAssistantSettings") { EntryPoints.openAssistantSettings(context) }
    Function("requestAddTile") { EntryPoints.requestAddTile(context) }
    Function("requestAddWidget") { EntryPoints.requestAddWidget(context) }

    // Country for laws that depend on location: SIM, then mobile network, then language setting.
    Function("countryCode") {
      val tm = context.getSystemService(android.telephony.TelephonyManager::class.java)
      listOf(tm?.simCountryIso, tm?.networkCountryIso, java.util.Locale.getDefault().country)
        .firstOrNull { !it.isNullOrBlank() }
        ?.uppercase()
    }

    Function("getDeviceInfo") {
      val mem = ActivityManager.MemoryInfo()
      (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
      mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "soc" to if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}" else Build.HARDWARE,
        "totalRamMb" to mem.totalMem / (1024 * 1024),
        "filesDir" to context.filesDir.absolutePath,
        "externalFilesDir" to context.getExternalFilesDir(null)?.absolutePath,
      )
    }

    AsyncFunction("llmLoad") { candidates: List<LlmCandidateRecord> ->
      val cands = candidates.map { LlmCandidate(it.modelPath, it.backend) }
      Embedder.unloadIfLowRam(context)
      Ocr.unload()
      val r = llm.load(cands)
      llm.rememberLoad(context, cands, r)
      mapOf("modelPath" to r.modelPath, "backend" to r.backend, "initMs" to r.initMs, "failures" to r.failures)
    }

    AsyncFunction("llmGenerate") {
      requestId: String,
      prompt: String,
      imagePath: String?,
      opts: GenerateOptionsRecord?,
      promise: Promise ->
      llm.generate(
        prompt,
        imagePath,
        GenerateOptions(opts?.maxTokens, opts?.keepHistory ?: false, opts?.system, opts?.scratch ?: false, opts?.undoable ?: false, opts?.offRecord ?: false, opts?.thinkingBudget, opts?.cacheSystem ?: false),
        onText = { sendEvent("onLlmText", mapOf("requestId" to requestId, "text" to it)) },
        onFinish = { s ->
          promise.resolve(
            mapOf(
              "ttftMs" to s.ttftMs,
              "prefillTokens" to s.prefillTokens,
              "prefillTokensPerSec" to s.prefillTokensPerSec,
              "decodeTokens" to s.decodeTokens,
              "decodeTokensPerSec" to s.decodeTokensPerSec,
              "totalMs" to s.totalMs,
              "firstTextMs" to s.firstTextMs,
              "thoughtChars" to s.thoughtChars,
            )
          )
        },
        onFail = { promise.reject(CodedException("ERR_LLM", it.message ?: "Generation failed", it)) },
      )
    }

    // Small key/value settings (backend choice, toggles). Not for secrets.
    Function("kvGet") { key: String -> prefs.getString(key, null) }

    Function("kvSet") { key: String, value: String? ->
      prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }

    Function("downloadStart") { url: String, destPath: String, title: String, wifiOnly: Boolean ->
      downloads.start(url, destPath, title, wifiOnly).toDouble()
    }

    Function("downloadStatus") { id: Double -> downloads.status(id.toLong()) }

    Function("downloadCancel") { id: Double -> downloads.cancel(id.toLong()) }

    // Hashing GBs takes seconds, so it runs off the JS thread.
    AsyncFunction("downloadFinish") { destPath: String, sha256: String -> downloads.finish(destPath, sha256) }

    // Continues a failed download from its partial file (HTTP Range); blocking, off the UI thread.
    AsyncFunction("downloadResume") { url: String, destPath: String ->
      downloads.resume(url, destPath)
      true
    }

    Function("downloadPartBytes") { destPath: String -> downloads.partBytes(destPath).toDouble() }

    Function("fileExists") { path: String -> java.io.File(path).isFile }

    Function("readBase64") { path: String ->
      java.io.File(path).takeIf { it.isFile }?.readBytes()?.let { android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP) }
    }

    Function("copyFile") { src: String, dst: String ->
      java.io.File(dst).parentFile?.mkdirs()
      java.io.File(src).copyTo(java.io.File(dst), overwrite = true)
      true
    }

    Function("deleteFile") { path: String -> java.io.File(path).deleteRecursively() }

    // Settings -> Privacy -> Delete all data: the system wipes everything the app keeps (files,
    // databases, settings, downloaded models) exactly as an uninstall would, then closes the app.
    Function("wipeAllData") {
      val am = context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager
      am.clearApplicationUserData()
    }

    // Data export: memory.json plus the original photos, in one zip.
    AsyncFunction("exportZip") { json: String, files: List<String>, destPath: String ->
      java.io.File(destPath).parentFile?.mkdirs()
      java.util.zip.ZipOutputStream(java.io.FileOutputStream(destPath)).use { zip ->
        zip.putNextEntry(java.util.zip.ZipEntry("memory.json"))
        zip.write(json.toByteArray())
        zip.closeEntry()
        for (f in files.map { java.io.File(it) }.filter { it.isFile }) {
          zip.putNextEntry(java.util.zip.ZipEntry("photos/${f.name}"))
          f.inputStream().use { it.copyTo(zip) }
          zip.closeEntry()
        }
      }
      destPath
    }

    Function("readText") { path: String -> java.io.File(path).takeIf { it.isFile }?.readText() }

    // Speech model archives (.tar.bz2) are unpacked once after their SHA-256 check.
    AsyncFunction("extractTarBz2") { archive: String, destDir: String -> Archives.extractTarBz2(archive, destDir) }

    // --- Listening ---
    Function("listenConfigure") { wakeKeywords: String, wakePhrase: String, recordAmbient: Boolean, jsAnswers: Boolean ->
      MicLoop.wakeKeywords = wakeKeywords
      MicLoop.wakePhrase = wakePhrase
      MicLoop.recordAmbient = recordAmbient
      MicLoop.jsAnswers = jsAnswers
      appContext.reactContext?.let { ListenPrefs.save(it) }
    }
    Function("listenCommandsOnly") { on: Boolean ->
      MicLoop.commandsOnly = on
      appContext.reactContext?.let { ListenPrefs.save(it) }
    }
    // The owner's voiceprint (null: not known yet); only it may interrupt Sidekick.
    Function("listenSetOwnerVoice") { centroid: List<Double>? ->
      OwnerVoice.set(context, centroid?.map { it.toFloat() }?.toFloatArray())
    }

    // --- Places ---
    // Freshest known location (≤ 2 h old) or null; also requests a new fix for next time.
    Function("lastLocation") {
      Places.current(context)?.let {
        mapOf(
          "lat" to it.latitude,
          "lon" to it.longitude,
          "accuracyM" to it.accuracy.toDouble(),
          "at" to it.time.toDouble(),
        )
      }
    }

    Function("hasLocationPermission") { Places.hasPermission(context) }

    // Car kits' Bluetooth names (regex source); when one disconnects, the spot is marked "parked".
    Function("placesSetCarPattern") { pattern: String? ->
      Places.carPattern = pattern?.let { runCatching { Regex(it, RegexOption.IGNORE_CASE) }.getOrNull() }
    }

    // Street and town for a position via Android's Geocoder (online on most phones; JS calls it
    // only when Online lookup is on). Null when unavailable.
    AsyncFunction("reverseGeocode") { lat: Double, lon: Double ->
      if (!android.location.Geocoder.isPresent()) return@AsyncFunction null
      runCatching {
        @Suppress("DEPRECATION")
        val a = android.location.Geocoder(context).getFromLocation(lat, lon, 1)?.firstOrNull()
        a?.let {
          listOfNotNull(
            listOfNotNull(it.subThoroughfare, it.thoroughfare).joinToString(" ").ifBlank { null },
            it.subLocality,
            it.locality,
          ).distinct().joinToString(", ").ifBlank { null }
        }
      }.getOrNull()
    }

    // Quiet hours and paused places for auto-pause (JSON, see Places.setRules).
    Function("listenPauseRules") { json: String -> Places.setRules(json) }

    Function("listenPauseReason") { MicLoop.pauseReason }

    // Off the record: speech audio is not saved.
    Function("audioSaveEnabled") { on: Boolean -> SpeechAudio.enabled = on }

    Function("listenStart") { ListenService.startListening(context) }

    // Listening was on when the app last ran (it stays on after the app is killed and reopened).
    Function("listenWanted") { ListenService.wanted(context) }

    Function("listenStop") { ListenService.stopListening(context) }

    Function("listenActive") { ListenService.active }

    Function("setMicPaused") { paused: Boolean -> MicLoop.setPaused(paused) }

    // --- Spoken answers (Pocket TTS, else the system voice); see Voice.kt ---
    // Starts an answer; the id ties its sentences together so a stopped answer stays silent.
    Function("voiceBegin") { Voice.begin() }

    Function("voiceSay") { text: String, answer: Int -> Voice.say(context, text, answer) }

    // The answer is complete: the follow-up window opens when the last sentence has been heard.
    Function("voiceEnd") { answer: Int -> Voice.end(answer) }

    Function("voiceStop") { Voice.stop() }

    Function("voiceEngine") { Voice.engineName(context) }

    // The one voice this phone uses (decided once, see Voice.kt) and the owner's override.
    Function("voiceInfo") {
      val i = Voice.info(context)
      mapOf("choice" to i.choice, "measuredMs" to i.measuredMs, "override" to i.override, "active" to i.active)
    }

    Function("voiceSetChoice") { choice: String -> Voice.setOverride(context, choice) }

    // Speech speed of spoken answers (1 = normal, 0.5–2).
    Function("voiceSetRate") { r: Double -> Voice.setRate(r.toFloat()) }

    // QR codes and barcodes in a picture (ZXing, on the phone); JSON list of {format, text}.
    AsyncFunction("scanCodes") { path: String -> Codes.scan(path) }

    // Wi-Fi from a QR code: the system "Save this network?" sheet (Android 11+); false if not shown.
    Function("wifiAddNetwork") { ssid: String, password: String?, security: String -> Codes.addWifi(context, ssid, password, security) }

    // Long-press icon shortcuts: Ask, Listen, Camera, Remember this.
    Function("setAppShortcuts") { Shortcuts.publish(context) }

    // The language answers are spoken in ("" = the phone's); not English means the system voice.
    Function("voiceSetLanguage") { tag: String -> Voice.setLanguage(context, tag) }

    Function("pttStart") { MicLoop.startPtt(context) }

    // Transcribes what was said while the button was held, plus a voiceprint of the speaker.
    AsyncFunction("pttStop") {
      val audio = MicLoop.stopPtt()
      if (audio.size < SAMPLE_RATE / 4) return@AsyncFunction mapOf("text" to "", "voice" to null)
      val engine = Speech.engine(context, MicLoop.wakeKeywords)
      mapOf("text" to engine.transcribe(audio), "voice" to engine.voiceprint(audio)?.map { it.toDouble() })
    }

    // Loads the speech models now (so the first push-to-talk isn't slow); throws if any are missing.
    AsyncFunction("speechWarmUp") { Speech.engine(context, MicLoop.wakeKeywords); true }

    // Parakeet CPU threads (default 4); reloads speech-to-text if loaded. For the speed bench.
    AsyncFunction("speechSetAsrThreads") { threads: Int -> SpeechEngine.configureAsrThreads(threads); true }

    // Parakeet build (v2 English / v3 multilingual, see language-logic.ts); false if not downloaded.
    AsyncFunction("speechSetAsrModel") { dir: String -> SpeechEngine.configureAsrModel(Speech.modelsDir(context), dir) }

    // The phone's language setting as a BCP-47 tag ("de-AT").
    Function("phoneLocale") { java.util.Locale.getDefault().toLanguageTag() }

    // Memory search vectors. Runs off the JS thread; returns one vector per text.
    AsyncFunction("embed") { modelPath: String, texts: List<String>, dims: Int ->
      Embedder.embed(context, modelPath, texts, dims).map { v -> v.map { it.toDouble() } }
    }

    // Photo vectors in the same space as "embed", so a text question finds a photo by meaning.
    AsyncFunction("embedImages") { modelPath: String, photoPaths: List<String>, dims: Int ->
      Embedder.embedImages(context, modelPath, photoPaths, dims).map { v -> v.map { it.toDouble() } }
    }

    AsyncFunction("embedUnload") { Embedder.unload() }

    // Text in a photo (PP-OCRv6 small), in reading order; ~sub-second, so it runs on every save.
    AsyncFunction("ocrPhoto") { detPath: String, recPath: String, dictPath: String, photoPath: String ->
      val t0 = android.os.SystemClock.elapsedRealtime()
      val lines = Ocr.read(detPath, recPath, dictPath, photoPath)
      mapOf(
        "lines" to lines.map { it.text },
        "scores" to lines.map { it.score.toDouble() },
        "ms" to (android.os.SystemClock.elapsedRealtime() - t0).toDouble(),
      )
    }

    AsyncFunction("ocrUnload") { Ocr.unload() }

    // Light photo edits (PhotoEdit.kt): a new file each time; the original is kept.
    AsyncFunction("photoEdit") { photoPath: String, op: String, args: Map<String, Any?>, segModelPath: String? ->
      val r = PhotoEdit.edit(context, photoPath, op, args, segModelPath)
      mapOf(
        "path" to r.path,
        "width" to r.width,
        "height" to r.height,
        "ms" to r.ms.toDouble(),
        "segMs" to r.segMs.toDouble(),
      )
    }

    AsyncFunction("photoEditUnload") { PhotoEdit.unload() }

    // --- Pictures made on the phone (ImageGen.kt; which picture is decided in JS) ---
    // True on 64-bit ARM phones with dot product and FP16 (the library is built for those).
    Function("pictureSupported") { ImageGen.supported }

    // Draws one 512x512 picture; progress arrives as onPicture events. Rejects "cancelled" on Stop.
    AsyncFunction("pictureMake") { modelPath: String, taesdPath: String?, prompt: String, seed: Double ->
      val r =
        ImageGen.generate(context, modelPath, taesdPath, prompt, seed.toLong()) { stage, done, total ->
          sendEvent("onPicture", mapOf("stage" to stage, "done" to done.toDouble(), "total" to total.toDouble()))
        }
      mapOf("path" to r.path, "width" to r.width, "height" to r.height, "ms" to r.ms.toDouble())
    }

    Function("pictureStop") { ImageGen.cancel() }

    AsyncFunction("pictureUnload") { ImageGen.unloadIfIdle(0) }

    // --- PDFs in picked folders (one page per call, so JS can pace them) ---
    Function("pdfCanReadText") { Pdf.canReadText }

    // Page count and one page's embedded text (null when this Android can't read PDF text).
    AsyncFunction("pdfPageText") { uri: String, index: Int ->
      val (pages, text) = Pdf.pageText(context, uri, index)
      mapOf("pages" to pages, "text" to text)
    }

    // One page rendered at 1600 px and OCR'd (for scans).
    AsyncFunction("pdfPageOcr") { uri: String, index: Int, detPath: String, recPath: String, dictPath: String ->
      val t0 = android.os.SystemClock.elapsedRealtime()
      val img = Pdf.renderPage(context, uri, index)
      val lines = try {
        Ocr.readBitmap(detPath, recPath, dictPath, img)
      } finally {
        img.recycle()
      }
      mapOf(
        "lines" to lines.map { it.text },
        "ms" to (android.os.SystemClock.elapsedRealtime() - t0).toDouble(),
      )
    }

    // --- Developer checks (speed-test screen) ---
    // Runs a 16 kHz mono 16-bit WAV through speech-to-text and the wake word spotter.
    AsyncFunction("debugTranscribe") { wavPath: String ->
      val audio = Wav.read16kMono(java.io.File(wavPath))
      val engine = Speech.engine(context, MicLoop.wakeKeywords)
      val wake = engine.newWakeStream(MicLoop.wakeKeywords)
      var heard = false
      for (i in 0 until audio.size step SpeechEngine.VAD_WINDOW) {
        if (engine.wakeHeard(wake, audio.copyOfRange(i, minOf(i + SpeechEngine.VAD_WINDOW, audio.size)))) heard = true
      }
      wake.release()
      mapOf("text" to engine.transcribe(audio), "wake" to heard)
    }

    // Speaks [text] with the system voice into a WAV file (to make test recordings on the phone).
    // [voice] picks a different installed offline English voice (to simulate another person).
    AsyncFunction("debugSay") { text: String, path: String, voice: Int?, promise: expo.modules.kotlin.Promise ->
      var tts: android.speech.tts.TextToSpeech? = null
      tts =
        android.speech.tts.TextToSpeech(context) { status ->
          val t = tts!!
          if (status != android.speech.tts.TextToSpeech.SUCCESS) {
            promise.reject("ERR_TTS", "Text-to-speech unavailable", null)
            return@TextToSpeech
          }
          if (voice != null) {
            val voices =
              t.voices.orEmpty()
                .filter { it.locale.language == "en" && !it.isNetworkConnectionRequired }
                .sortedBy { it.name }
            if (voices.isNotEmpty()) t.voice = voices[voice % voices.size]
          }
          t.setOnUtteranceProgressListener(
            object : android.speech.tts.UtteranceProgressListener() {
              override fun onStart(id: String?) {}

              override fun onDone(id: String?) {
                t.shutdown()
                promise.resolve(path)
              }

              @Deprecated("Deprecated in Java")
              override fun onError(id: String?) {
                t.shutdown()
                promise.reject("ERR_TTS", "Synthesis failed", null)
              }
            }
          )
          t.synthesizeToFile(text, null, java.io.File(path), "debug")
        }
    }

    // Plays a sound file out of the speaker (to test the microphone path end to end).
    // Voiceprint of a WAV file (to measure how well voices separate).
    AsyncFunction("debugVoiceprint") { wavPath: String ->
      val audio = Wav.read16kMono(java.io.File(wavPath))
      Speech.engine(context, MicLoop.wakeKeywords).voiceprint(audio)?.toList()
    }

    // Names of the offline English voices debugSay picks from, in index order.
    AsyncFunction("debugVoices") { promise: expo.modules.kotlin.Promise ->
      var tts: android.speech.tts.TextToSpeech? = null
      tts =
        android.speech.tts.TextToSpeech(context) { _ ->
          val t = tts!!
          val names =
            t.voices.orEmpty()
              .filter { it.locale.language == "en" && !it.isNetworkConnectionRequired }
              .sortedBy { it.name }
              .map { it.name }
          t.shutdown()
          promise.resolve(names)
        }
    }

    // Plays a sound file out of the speaker after [delayMs]; resolves when it has finished.
    AsyncFunction("debugPlay") { path: String, delayMs: Int?, promise: expo.modules.kotlin.Promise ->
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        try {
          android.media.MediaPlayer().apply {
            setDataSource(path)
            setOnCompletionListener {
              it.release()
              promise.resolve(true)
            }
            prepare()
            start()
          }
        } catch (e: Exception) {
          promise.reject("ERR_PLAY", e.message ?: "play failed", e)
        }
      }, (delayMs ?: 0).toLong())
    }

    Function("journalDrain") { Journal.drain(context) }
    Function("journalTake") {
      val t = Journal.take(context)
      mapOf("lines" to t.lines, "replayed" to t.replayed)
    }
    Function("journalAck") { Journal.ack(context) }

    // Live camera memory (engine/camera/LiveCapture.kt), run by the listening service.
    Function("cameraStart") { cfg: Map<String, Any?>? ->
      val granted =
        androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) ==
          android.content.pm.PackageManager.PERMISSION_GRANTED
      if (!granted) throw CodedException("ERR_CAMERA_PERMISSION", "Camera permission not granted", null)
      dev.sidekick.engine.camera.LiveCapture.configure(dev.sidekick.engine.camera.CaptureConfig.from(cfg))
      ListenService.startCamera(context)
      true
    }
    Function("cameraConfigure") { cfg: Map<String, Any?>? ->
      val c = dev.sidekick.engine.camera.CaptureConfig.from(cfg)
      StorageGuard.reserveMb = c.reserveMb
      dev.sidekick.engine.camera.LiveCapture.configure(c)
    }
    Function("cameraStop") { ListenService.stopCamera(context) }
    Function("cameraPause") { paused: Boolean -> ListenService.setCameraPaused(paused) }
    Function("cameraStatus") { dev.sidekick.engine.camera.LiveCapture.status() }
    Function("cameraHold") { hold: Boolean -> dev.sidekick.engine.camera.LiveCapture.hold = hold }
    Function("cameraFramesDrain") { max: Int? -> dev.sidekick.engine.camera.FrameJournal.drain(context, max ?: Int.MAX_VALUE) }
    Function("cameraLatestFrames") { n: Int -> dev.sidekick.engine.camera.LiveCapture.latestFrames(context, n) }
    AsyncFunction("cameraVideoBetween") { fromMs: Double, toMs: Double ->
      dev.sidekick.engine.camera.LiveCapture.videoSegmentsBetween(context, fromMs.toLong(), toMs.toLong())
    }
    AsyncFunction("cameraFramesAround") { atMs: Double, n: Int, spacingMs: Double ->
      dev.sidekick.engine.camera.LiveCapture.framesAround(context, atMs.toLong(), n, spacingMs.toLong())
    }
    AsyncFunction("cameraStorageUsage") { dev.sidekick.engine.camera.LiveCapture.storageUsage(context) }
    Function("deviceState") {
      val s = dev.sidekick.engine.camera.LiveCapture.deviceState(context)
      mapOf(
        "thermalStatus" to s.thermalStatus,
        "batteryPct" to s.batteryPct,
        "charging" to s.charging,
        "lowMemory" to s.lowMemory,
        "tempC" to s.tempC?.toDouble(),
      )
    }

    // Data source: other apps' notifications (NotificationCapture.kt). Off unless enabled.
    Function("notificationAccessGranted") { NotificationCapture.accessGranted(context) }
    Function("openNotificationAccessSettings") { NotificationCapture.openAccessSettings(context) }
    Function("notificationsSetCapture") { enabled: Boolean -> NotificationCapture.setCapture(context, enabled) }
    Function("notificationsDrain") { NotificationCapture.drain(context) }

    Function("llmIsLoaded") { llm.loaded != null }

    // Speed knobs for the bench; see LlmTuning for when each takes effect.
    Function("llmSetTuning") { t: LlmTuningRecord ->
      llm.tuning = LlmTuning(t.threads, t.speculative, t.visualTokenBudget ?: DEFAULT_VISUAL_TOKENS, t.maxTokens, t.maxImageEdge ?: ModelImage.DEFAULT_MAX_EDGE)
      llm.resetBase()
    }

    // Reads the system prompt in ahead of the first question (no-op result false if not loaded).
    AsyncFunction("llmPrepare") { system: String? -> llm.prepare(system) }

    Function("llmCancel") { llm.cancel() }
    Function("llmUndoLast") { llm.undoLast() }

    AsyncFunction("llmUnload") { llm.unload() }

    // Inputs and outputs (engine/usb). USB cameras: Android-only, needs CAMERA granted first.
    Function("usbCameraList") { dev.sidekick.engine.usb.UsbCameras.list(context) }
    Function("usbCameraOpen") { width: Int, height: Int, fps: Int ->
      dev.sidekick.engine.usb.UsbCameras.width = width
      dev.sidekick.engine.usb.UsbCameras.height = height
      dev.sidekick.engine.usb.UsbCameras.fps = fps
      dev.sidekick.engine.usb.UsbCameras.open(context)
    }
    Function("usbCameraUsePhone") { dev.sidekick.engine.usb.UsbCameras.usePhoneCamera() }
    Function("usbCameraMode") {
      dev.sidekick.engine.usb.UsbCameras.source?.mode?.let {
        mapOf("width" to it.width, "height" to it.height, "fps" to it.fps, "mjpeg" to it.mjpeg)
      }
    }
    Function("audioDevices") {
      dev.sidekick.engine.usb.AudioRoutes.init(context)
      dev.sidekick.engine.usb.AudioRoutes.snapshot()
    }
    Function("headphonesOn") {
      dev.sidekick.engine.usb.AudioRoutes.init(context)
      dev.sidekick.engine.usb.AudioRoutes.headphonesOn()
    }
    Function("audioSetOverride") { input: String?, output: String? ->
      dev.sidekick.engine.usb.AudioRoutes.inputOverride = input
      dev.sidekick.engine.usb.AudioRoutes.outputOverride = output
    }
    Function("audioSetAsking") { on: Boolean ->
      if (on) dev.sidekick.engine.usb.AudioRoutes.beginAsk() else dev.sidekick.engine.usb.AudioRoutes.endAsk()
    }
    AsyncFunction("audioProbeSplit") { dev.sidekick.engine.usb.AudioRoutes.probeSplit() }
    Function("mediaButtonsEnable") { on: Boolean -> dev.sidekick.engine.usb.MediaButtons.enable(context, on) }

    OnDestroy {
      MicLoop.listener = null
      MemoryWatch.listener = null
      Voice.onIdle = null
      dev.sidekick.engine.usb.UsbCameras.listener = null
      dev.sidekick.engine.usb.AudioRoutes.listener = null
      dev.sidekick.engine.usb.MediaButtons.listener = null
      if (!ListenService.active) llm.unload()
    }
  }
}
