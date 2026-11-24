import ExpoModulesCore

// iOS engine (LiteRT-LM Swift, Metal) comes after the Android MVP; until then calls reject clearly.
public class SidekickNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SidekickNative")

    Events("onLlmText")

    Function("getDeviceInfo") { () -> [String: Any] in
      [
        "manufacturer": "Apple",
        "model": UIDevice.current.model,
        "soc": "",
        "totalRamMb": ProcessInfo.processInfo.physicalMemory / (1024 * 1024),
        "filesDir": FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.path ?? "",
        "externalFilesDir": NSNull(),
      ]
    }

    AsyncFunction("llmLoad") { (_: [[String: String]]) in
      throw Exception(name: "ERR_LLM", description: "On-device model not implemented on iOS yet")
    }

    AsyncFunction("llmGenerate") { (_: String, _: String, _: String?, _: [String: Any]?) in
      throw Exception(name: "ERR_LLM", description: "On-device model not implemented on iOS yet")
    }

    Function("kvGet") { (key: String) -> String? in UserDefaults.standard.string(forKey: "sidekick." + key) }

    Function("kvSet") { (key: String, value: String?) in
      UserDefaults.standard.set(value, forKey: "sidekick." + key)
    }

    Function("downloadStart") { (_: String, _: String, _: String, _: Bool) -> Double in
      throw Exception(name: "ERR_DOWNLOAD", description: "Model downloads not implemented on iOS yet")
    }

    Function("downloadStatus") { (_: Double) -> [String: Any] in
      ["status": "failed", "bytes": 0, "total": -1, "reason": -1]
    }

    Function("downloadCancel") { (_: Double) in }

    AsyncFunction("downloadFinish") { (_: String, _: String) -> Bool in false }

    Function("fileExists") { (path: String) -> Bool in FileManager.default.fileExists(atPath: path) }

    Function("llmCancel") {}

    Function("llmUndoLast") { () -> Bool in false }

    AsyncFunction("llmUnload") {}

    Function("llmSetTuning") { (_: [String: Any]) in }

    AsyncFunction("llmPrepare") { (_: String?) -> Bool in false }
  }
}
