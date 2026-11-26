import AVFoundation
import ExpoModulesCore
import UIKit
import os

/// The iPhone side of the native module. It covers what the iPhone can do: the chat model and
/// memory search (LiteRT-LM, CPU), push-to-talk (Apple's on-device speech recognizer), photo text
/// and QR codes (Vision), PDFs (PDFKit), files, downloads' checks and device state. Android-only
/// calls (background listening, live camera, USB, notifications, Pocket voice...) are not defined
/// here; the JS wrapper (src/ios-fallbacks.ts) answers those with a plain "not on iPhone" value.
public class SidekickNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SidekickNative")

    Events("onLlmText", "onPartialTranscript")

    OnCreate {
      DispatchQueue.main.async { UIDevice.current.isBatteryMonitoringEnabled = true }
      PushToTalk.shared.onPartial = { [weak self] text in
        self?.sendEvent("onPartialTranscript", ["text": text, "source": "ptt"])
      }
    }

    Function("getDeviceInfo") { () -> [String: Any] in
      let machine = SidekickNativeModule.machine()
      return [
        "manufacturer": "Apple",
        "model": machine,
        "soc": SidekickNativeModule.chip(machine),
        "totalRamMb": Double(MemoryBudget.totalMb),
        "filesDir": Files.root.path,
        "externalFilesDir": NSNull(),
      ]
    }

    // The App Store region, else the phone's region setting.
    Function("countryCode") { () -> String? in
      let region = Locale.current.region?.identifier
      return region?.isEmpty == false ? region!.uppercased() : nil
    }

    Function("phoneLocale") { () -> String in
      Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
    }

    // Small key/value settings. Not for secrets.
    Function("kvGet") { (key: String) -> String? in
      UserDefaults.standard.string(forKey: "sidekick." + key)
    }

    Function("kvSet") { (key: String, value: String?) in
      if let v = value {
        UserDefaults.standard.set(v, forKey: "sidekick." + key)
      } else {
        UserDefaults.standard.removeObject(forKey: "sidekick." + key)
      }
    }

    // --- Files ---
    Function("fileExists") { (path: String) -> Bool in Files.isFile(path) }

    Function("readText") { (path: String) -> String? in
      Files.isFile(path) ? (try? String(contentsOfFile: path, encoding: .utf8)) : nil
    }

    Function("readBase64") { (path: String) -> String? in
      Files.isFile(path) ? FileManager.default.contents(atPath: path)?.base64EncodedString() : nil
    }

    Function("copyFile") { (src: String, dst: String) -> Bool in
      (try? Files.copy(src, dst)) != nil
    }

    Function("deleteFile") { (path: String) -> Bool in Files.delete(path) }

    Function("excludeFromBackup") { (path: String) -> Bool in Files.excludeFromBackup(path) }

    // iPhone: wipes files, settings and keychain; JS then restarts the app (data-export.ts).
    Function("wipeAllData") { () -> Bool in Files.wipeAll() }

    AsyncFunction("exportZip") { (json: String, files: [String], destPath: String) throws -> String in
      try Files.exportZip(json: json, files: files, destPath: destPath)
    }

    // The offline place-name pack bundled with the app (see geo-pack.ts).
    Function("geoPack") { () -> Data? in
      let bundles = [Bundle.main, Bundle(for: SidekickNativeModule.self)]
      for b in bundles {
        if let url = b.url(forResource: "SidekickGeo", withExtension: "bundle"),
          let geo = Bundle(url: url),
          let file = geo.url(forResource: "places500", withExtension: "bin")
        {
          return try? Data(contentsOf: file, options: .mappedIfSafe)
        }
      }
      return nil
    }

    // --- Downloads: the transfer itself is expo-file-system's background URLSession (JS). ---
    Function("downloadPartBytes") { (destPath: String) -> Double in Files.size(destPath + ".part") }

    // Hashing GBs takes seconds, so it runs off the JS thread.
    AsyncFunction("downloadFinish") { (destPath: String, sha256: String) throws -> Bool in
      try Files.finishDownload(destPath, sha256)
    }

    // --- Chat model ---
    AsyncFunction("llmLoad") { (candidates: [[String: String]], promise: Promise) in
      Task {
        do {
          promise.resolve(try await Llm.shared.load(candidates))
        } catch {
          promise.reject("ERR_LLM", error.localizedDescription)
        }
      }
    }

    AsyncFunction("llmGenerate") {
      (requestId: String, prompt: String, imagePath: String?, opts: [String: Any]?, promise: Promise) in
      Task {
        do {
          let stats = try await Llm.shared.generate(
            prompt: prompt, imagePath: imagePath, opts: opts ?? [:]
          ) { [weak self] text in
            self?.sendEvent("onLlmText", ["requestId": requestId, "text": text])
          }
          promise.resolve(stats)
        } catch {
          promise.reject("ERR_LLM", error.localizedDescription)
        }
      }
    }

    Function("llmIsLoaded") { () -> Bool in LlmState.shared.loaded }

    Function("llmSetTuning") { (t: [String: Any]) in
      var tuning = LlmTuning()
      tuning.threads = (t["threads"] as? NSNumber)?.intValue
      tuning.speculative = t["speculative"] as? String
      if let v = (t["visualTokenBudget"] as? NSNumber)?.intValue { tuning.visualTokenBudget = v }
      tuning.maxTokens = (t["maxTokens"] as? NSNumber)?.intValue
      if let v = (t["maxImageEdge"] as? NSNumber)?.intValue { tuning.maxImageEdge = v }
      let next = tuning
      Task { await Llm.shared.setTuning(next) }
    }

    AsyncFunction("llmPrepare") { (system: String?, promise: Promise) in
      Task { promise.resolve(await Llm.shared.prepare(system)) }
    }

    Function("llmCancel") { LlmState.shared.cancel() }

    // Synchronous like Android: the undo must land before the next question is sent.
    Function("llmUndoLast") { () -> Bool in
      let done = DispatchSemaphore(value: 0)
      let result = UndoResult()
      Task {
        result.value = await Llm.shared.undoLast()
        done.signal()
      }
      _ = done.wait(timeout: .now() + 2)
      return result.value
    }

    AsyncFunction("llmUnload") { (promise: Promise) in
      Task {
        await Llm.shared.unload()
        promise.resolve(nil)
      }
    }

    // --- Memory search vectors ---
    AsyncFunction("embed") { (modelPath: String, texts: [String], dims: Int, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Embedder.shared.embed(modelPath, texts, dims))
        } catch {
          promise.reject("ERR_EMBED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("embedImages") { (modelPath: String, photos: [String], dims: Int, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Embedder.shared.embedImages(modelPath, photos, dims))
        } catch {
          promise.reject("ERR_EMBED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("embedUnload") { (promise: Promise) in
      Task {
        await Embedder.shared.unload()
        promise.resolve(nil)
      }
    }

    // --- Photo text, codes, PDFs (Vision / PDFKit; the model paths are not needed here) ---
    AsyncFunction("ocrPhoto") {
      (_: String, _: String, _: String, photoPath: String) throws -> [String: Any] in
      let t0 = Date()
      let lines = try VisionText.readPhoto(photoPath)
      return [
        "lines": lines.map { $0.text },
        "scores": lines.map { Double($0.score) },
        "ms": Date().timeIntervalSince(t0) * 1000,
      ]
    }

    AsyncFunction("ocrUnload") {}

    AsyncFunction("scanCodes") { (path: String) throws -> String in try VisionText.scanCodes(path) }

    Function("pdfCanReadText") { () -> Bool in true }

    AsyncFunction("pdfPageText") { (uri: String, index: Int) -> [String: Any] in
      VisionText.pdfPageText(uri, index)
    }

    AsyncFunction("pdfPageOcr") {
      (uri: String, index: Int, _: String, _: String, _: String) throws -> [String: Any] in
      let t0 = Date()
      let lines = try VisionText.pdfPageOcr(uri, index)
      return ["lines": lines, "ms": Date().timeIntervalSince(t0) * 1000]
    }

    // --- Push-to-talk ---
    AsyncFunction("speechRequestAccess") { (promise: Promise) in
      PushToTalk.requestAccess { promise.resolve($0) }
    }

    AsyncFunction("speechWarmUp") { () -> Bool in PushToTalk.availableOffline() }

    Function("pttStart") { PushToTalk.shared.start() }

    AsyncFunction("pttStop") { (promise: Promise) in
      PushToTalk.shared.stop { result in
        switch result {
        case .success(let text): promise.resolve(["text": text, "voice": NSNull()])
        case .failure(let e): promise.reject("ERR_SPEECH", e.localizedDescription)
        }
      }
    }

    // --- Device state ---
    Function("deviceState") { () -> [String: Any] in
      let device = UIDevice.current
      let level = device.batteryLevel
      let thermal: Int
      switch ProcessInfo.processInfo.thermalState {
      case .nominal: thermal = 0
      case .fair: thermal = 2
      case .serious: thermal = 3
      case .critical: thermal = 4
      @unknown default: thermal = 0
      }
      return [
        "thermalStatus": thermal,
        "batteryPct": level < 0 ? -1 : Int((level * 100).rounded()),
        "charging": device.batteryState == .charging || device.batteryState == .full,
        "lowMemory": os_proc_available_memory() < 300 * 1024 * 1024,
        "tempC": NSNull(),
      ]
    }

    Function("headphonesOn") { () -> Bool in
      let worn: [AVAudioSession.Port] = [
        .headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .usbAudio, .carAudio,
      ]
      return AVAudioSession.sharedInstance().currentRoute.outputs.contains { worn.contains($0.portType) }
    }
  }

  /// "iPhone14,4" (iPhone 13 mini).
  static func machine() -> String {
    var info = utsname()
    uname(&info)
    let bytes = Mirror(reflecting: info.machine).children.compactMap { $0.value as? Int8 }
    let raw = String(bytes: bytes.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, encoding: .ascii)
    return raw ?? UIDevice.current.model
  }

  /// The chip from the model number: iPhone14,x = A15 … (each generation adds one).
  static func chip(_ machine: String) -> String {
    guard machine.hasPrefix("iPhone"),
      let major = Int(machine.dropFirst("iPhone".count).prefix { $0.isNumber }),
      major >= 11
    else { return "" }
    return "Apple A\(major + 1)"
  }
}

private final class UndoResult {
  var value = false
}
