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
}

class SidekickNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  private val prefs by lazy { context.getSharedPreferences("sidekick", Context.MODE_PRIVATE) }

  private val downloads by lazy { Downloads(context) }

  private val llm get() = Engines.llm(context)

  override fun definition() = ModuleDefinition {
    Name("SidekickNative")

    Events("onLlmText", "onWake", "onTranscript", "onQuestion", "onListenError")

    OnCreate { MicLoop.listener = { name, body -> sendEvent(name, body) } }

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
        GenerateOptions(opts?.maxTokens, opts?.keepHistory ?: false, opts?.system),
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

    Function("fileExists") { path: String -> java.io.File(path).isFile }

    Function("readBase64") { path: String ->
      java.io.File(path).takeIf { it.isFile }?.readBytes()?.let { android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP) }
    }

    Function("copyFile") { src: String, dst: String ->
      java.io.File(dst).parentFile?.mkdirs()
      java.io.File(src).copyTo(java.io.File(dst), overwrite = true)
      true
    }

    Function("deleteFile") { path: String -> java.io.File(path).delete() }

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
    }

    Function("listenStart") { ListenService.startListening(context) }

    Function("listenStop") { ListenService.stopListening(context) }

    Function("listenActive") { ListenService.active }

    Function("setMicPaused") { paused: Boolean -> MicLoop.setPaused(paused) }

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

    // Memory search vectors. Runs off the JS thread; returns one vector per text.
    AsyncFunction("embed") { modelPath: String, texts: List<String>, dims: Int ->
      Embedder.embed(context, modelPath, texts, dims).map { v -> v.map { it.toDouble() } }
    }

    AsyncFunction("embedUnload") { Embedder.unload() }

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

    // Plays a sound file out of the speaker (to test the microphone path end to end).
    AsyncFunction("debugPlay") { path: String ->
      android.media.MediaPlayer().apply {
        setDataSource(path)
        setOnCompletionListener { it.release() }
        prepare()
        start()
      }
      true
    }

    Function("journalDrain") { Journal.drain(context) }

    Function("llmIsLoaded") { llm.loaded != null }

    Function("llmCancel") { llm.cancel() }

    AsyncFunction("llmUnload") { llm.unload() }

    OnDestroy {
      MicLoop.listener = null
      if (!ListenService.active) llm.unload()
    }
  }
}
