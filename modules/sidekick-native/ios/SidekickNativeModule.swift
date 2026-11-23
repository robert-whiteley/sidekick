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

    AsyncFunction("llmGenerate") { (_: String, _: String, _: String?) in
      throw Exception(name: "ERR_LLM", description: "On-device model not implemented on iOS yet")
    }

    Function("llmCancel") {}

    AsyncFunction("llmUnload") {}
  }
}
