import Foundation
import os

/// Thread-safe flags the synchronous JS calls read without waiting for the engines.
final class LlmState {
  static let shared = LlmState()
  private let lock = NSLock()
  private var _loaded = false
  private var _running: Conversation?
  private var _cancelled = false

  var loaded: Bool {
    get { lock.lock(); defer { lock.unlock() }; return _loaded }
    set { lock.lock(); _loaded = newValue; lock.unlock() }
  }

  /// The conversation answering right now, so llmCancel can reach it at once.
  func setRunning(_ c: Conversation?) {
    lock.lock()
    _running = c
    _cancelled = false
    lock.unlock()
  }

  var cancelled: Bool {
    lock.lock(); defer { lock.unlock() }; return _cancelled
  }

  func cancel() {
    lock.lock()
    let c = _running
    _cancelled = c != nil
    lock.unlock()
    try? c?.cancel()
  }
}

/// Memory budget (ARCHITECTURE.md): on phones under 6 GB (iPhone 13 mini: 4 GB) the chat model and
/// the embedder are never loaded together; loading one unloads the other first.
enum MemoryBudget {
  static var totalMb: UInt64 { ProcessInfo.processInfo.physicalMemory / (1024 * 1024) }

  static func mustBeAlone() -> Bool {
    if totalMb < 6 * 1024 { return true }
    // 0 means no memory limit to report (the Simulator): the RAM rule alone decides. Read as "no
    // room", it unloaded the chat model for every question there.
    let available = os_proc_available_memory()
    return available > 0 && available < 1_500 * 1024 * 1024
  }
}

/// One change at a time to which big models are in memory (load the chat model, load the embedder,
/// unload either). Actors let another call in at every await, so without this a chat-model load
/// and an embedder load could each find the other not loaded yet and both end up in memory.
/// Answers and vectors don't wait here; an unload waits for the work using that model instead.
actor ModelGate {
  static let shared = ModelGate()
  private var held = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  private func lock() async {
    if !held {
      held = true
      return
    }
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in waiting.append(c) }
  }

  private func unlock() {
    if waiting.isEmpty { held = false } else { waiting.removeFirst().resume() }
  }

  /// Runs [body] as the only model change in progress (first come, first served).
  static func change<T>(_ body: () async throws -> T) async throws -> T {
    await shared.lock()
    do {
      let r = try await body()
      await shared.unlock()
      return r
    } catch {
      await shared.unlock()
      throw error
    }
  }
}

/// The JS module's entry points for the two big models, each change through [ModelGate].
enum Models {
  static func loadLlm(_ candidates: [[String: String]]) async throws -> [String: Any] {
    try await ModelGate.change { try await Llm.shared.load(candidates) }
  }

  static func unloadLlm() async {
    _ = try? await ModelGate.change { await Llm.shared.unload() }
  }

  static func unloadEmbedder() async {
    _ = try? await ModelGate.change { await Embedder.shared.unload() }
  }

  static func embed(_ modelPath: String, _ texts: [String], _ dims: Int) async throws -> [[Double]] {
    try await withEmbedder(modelPath) { try await Embedder.shared.embedIfLoaded(modelPath, texts, dims) }
  }

  static func embedImages(_ modelPath: String, _ photos: [String], _ dims: Int) async throws -> [[Double]] {
    try await withEmbedder(modelPath) {
      try await Embedder.shared.embedImagesIfLoaded(modelPath, photos, dims)
    }
  }

  /// Loads the embedder (a change), then uses it; if a chat-model load unloaded it in between, again.
  private static func withEmbedder(
    _ modelPath: String, _ use: () async throws -> [[Double]]?
  ) async throws -> [[Double]] {
    for _ in 0..<3 {
      try await ModelGate.change { try await Embedder.shared.ensureLoaded(modelPath) }
      if let r = try await use() { return r }
    }
    throw NSError(
      domain: "Sidekick", code: 4,
      userInfo: [NSLocalizedDescriptionKey: "The memory search model was unloaded while in use."])
  }
}

/// Counts the work using one model, so an unload can wait until it is done.
struct InUse {
  private(set) var count = 0
  private var idle: [CheckedContinuation<Void, Never>] = []

  mutating func begin() { count += 1 }

  mutating func end() {
    count -= 1
    if count == 0 {
      let w = idle
      idle = []
      for c in w { c.resume() }
    }
  }

  mutating func waitingForIdle(_ c: CheckedContinuation<Void, Never>) { idle.append(c) }
}

struct LlmTuning {
  var threads: Int?
  var speculative: String?
  var visualTokenBudget: Int = 140
  var maxTokens: Int?
  var maxImageEdge: Int = 768
}

/// LiteRT-LM on the iPhone (CPU). Mirrors LlmEngine.kt: one main chat, a separate "Off the record"
/// chat, throwaway side conversations, and an undo copy of the chat before an undoable turn.
actor Llm {
  static let shared = Llm()

  private var engine: Engine?
  private var loadedInfo: [String: Any]?
  private var chat: Conversation?
  /// The chat has no turns yet (made by prepare), so a fresh question can use it as it is.
  private var chatUnused = false
  private var offRecord: Conversation?
  private var before: Conversation?
  private var beforeOffRecord = false
  private var system: String?
  private var offRecordSystem: String?
  /// Answers and prepares running now; an unload stops the answer and waits for them.
  private var inUse = InUse()
  /// An unload is waiting: nothing new starts on the engine being freed.
  private var closing = false
  var tuning = LlmTuning()

  func setTuning(_ t: LlmTuning) {
    tuning = t
  }

  private func backend(_ name: String) -> Backend {
    return .cpu(threadCount: tuning.threads)
  }

  private func speculative() -> SpeculativeDecodingConfig? {
    switch tuning.speculative {
    case "on": return SpeculativeDecodingConfig(mode: .on)
    case "adaptive": return SpeculativeDecodingConfig(mode: .adaptive)
    case "off": return SpeculativeDecodingConfig(mode: .off)
    default: return nil
    }
  }

  /// Call through Models.loadLlm (one model change at a time).
  func load(_ candidates: [[String: String]]) async throws -> [String: Any] {
    await unload()
    if MemoryBudget.mustBeAlone() { await Embedder.shared.unload() }
    ExperimentalFlags.optIntoExperimentalAPIs()
    ExperimentalFlags.enableBenchmark = true
    ExperimentalFlags.visualTokenBudget = Int32(tuning.visualTokenBudget)
    var failures: [String] = []
    let cache = Files.root.appendingPathComponent("llm-cache", isDirectory: true)
    try? FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    for c in candidates {
      let path = c["modelPath"] ?? ""
      let name = c["backend"] ?? "cpu"
      // The iPhone build runs on the CPU for now: the Metal accelerator isn't in LiteRT-LM's
      // published iOS framework yet (ADR 0006). Other backends are reported, not tried.
      if name != "cpu" {
        failures.append("\(name): not available on iPhone yet")
        continue
      }
      guard Files.isFile(path) else {
        failures.append("\(name): model not found at \(path)")
        continue
      }
      let start = Date()
      do {
        let config = try EngineConfig(
          modelPath: path,
          backend: backend(name),
          visionBackend: .cpu(),
          maxNumTokens: tuning.maxTokens,
          cacheDir: cache.path,
          speculativeDecodingConfig: speculative()
        )
        let e = Engine(engineConfig: config)
        try await e.initialize()
        // Prove the backend with a one-token answer before accepting it (as on Android).
        let probe = try await e.createConversation(with: ConversationConfig())
        _ = try await probe.sendMessage(Message("Hi"), maxOutputTokens: 1)
        engine = e
        let info: [String: Any] = [
          "modelPath": path, "backend": name,
          "initMs": Date().timeIntervalSince(start) * 1000, "failures": failures,
        ]
        loadedInfo = info
        LlmState.shared.loaded = true
        return info
      } catch {
        failures.append("\(name): \(error.localizedDescription)")
      }
    }
    throw NSError(
      domain: "Sidekick", code: 2,
      userInfo: [
        NSLocalizedDescriptionKey:
          "No backend could load the model. \(failures.joined(separator: "; "))"
      ])
  }

  private func fresh(_ e: Engine, _ system: String?) async throws -> Conversation {
    ExperimentalFlags.visualTokenBudget = Int32(tuning.visualTokenBudget)
    let sys = system.flatMap { $0.isEmpty ? nil : Message($0, role: .system) }
    return try await e.createConversation(with: ConversationConfig(systemMessage: sys))
  }

  private func keepUndoCopy(_ c: Conversation, undoable: Bool, offRecordChat: Bool) {
    before = nil
    guard undoable else { return }
    before = try? c.clone()
    beforeOffRecord = offRecordChat
  }

  func prepare(_ system: String?) async -> Bool {
    guard !closing, let e = engine else { return false }
    inUse.begin()
    defer { inUse.end() }
    // Never replaces a chat that already has turns (its history is the conversation).
    if chat == nil || (chatUnused && self.system != system) {
      chat = try? await fresh(e, system)
      chatUnused = chat != nil
      self.system = system
    }
    return true
  }

  func generate(
    prompt: String, imagePath: String?, opts: [String: Any],
    onText: @escaping (String) -> Void
  ) async throws -> [String: Any] {
    guard !closing, let e = engine else {
      throw NSError(domain: "Sidekick", code: 3, userInfo: [NSLocalizedDescriptionKey: "Model not loaded"])
    }
    inUse.begin()
    defer { inUse.end() }
    let keepHistory = opts["keepHistory"] as? Bool ?? false
    let scratch = opts["scratch"] as? Bool ?? false
    let undoable = opts["undoable"] as? Bool ?? false
    let offRec = opts["offRecord"] as? Bool ?? false
    let sys = opts["system"] as? String
    let maxTokens = (opts["maxTokens"] as? NSNumber)?.intValue

    let conv: Conversation
    if scratch {
      conv = try await fresh(e, sys)
    } else if offRec {
      if let o = offRecord, keepHistory {
        conv = o
      } else {
        conv = try await fresh(e, sys)
        offRecord = conv
        offRecordSystem = sys
      }
      keepUndoCopy(conv, undoable: undoable, offRecordChat: true)
    } else {
      // Back in the main chat: the off-the-record one is over.
      if beforeOffRecord { before = nil }
      offRecord = nil
      if let c = chat, keepHistory || (chatUnused && system == sys) {
        conv = c
      } else {
        conv = try await fresh(e, sys)
        chat = conv
        system = sys
      }
      chatUnused = false
      keepUndoCopy(conv, undoable: undoable, offRecordChat: false)
    }

    var contents: [Content] = []
    if let p = imagePath {
      contents.append(.imageFile(VisionText.prepare(p, maxEdge: tuning.maxImageEdge, name: "llm-input.jpg")))
    }
    contents.append(.text(prompt))
    let message = Message(contents: contents)

    let start = Date()
    LlmState.shared.setRunning(conv)
    defer { LlmState.shared.setRunning(nil) }
    do {
      for try await chunk in conv.sendMessageStream(message, maxOutputTokens: maxTokens) {
        let text = chunk.toString
        if !text.isEmpty { onText(text) }
      }
    } catch {
      // A stopped answer ends quietly with what was said so far (a question preempted it).
      if !LlmState.shared.cancelled { throw error }
    }
    let totalMs = Date().timeIntervalSince(start) * 1000
    guard let b = try? conv.getBenchmarkInfo() else {
      return [
        "ttftMs": 0, "prefillTokens": 0, "prefillTokensPerSec": 0, "decodeTokens": 0,
        "decodeTokensPerSec": 0, "totalMs": totalMs,
      ]
    }
    return [
      "ttftMs": b.timeToFirstTokenInSecond * 1000,
      "prefillTokens": b.lastPrefillTokenCount,
      "prefillTokensPerSec": b.lastPrefillTokensPerSecond,
      "decodeTokens": b.lastDecodeTokenCount,
      "decodeTokensPerSec": b.lastDecodeTokensPerSecond,
      "totalMs": totalMs,
    ]
  }

  func undoLast() -> Bool {
    guard let b = before else { return false }
    before = nil
    if beforeOffRecord { offRecord = b } else { chat = b }
    return true
  }

  /// Stops an answer being written and waits until nothing uses the engine, then frees it: freed
  /// while an answer still ran, the model stayed in memory beside the next one. Call through
  /// Models.unloadLlm, or inside a model change.
  func unload() async {
    closing = true
    while inUse.count > 0 {
      LlmState.shared.cancel()
      await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in inUse.waitingForIdle(c) }
    }
    before = nil
    offRecord = nil
    chat = nil
    chatUnused = false
    system = nil
    engine = nil
    loadedInfo = nil
    LlmState.shared.loaded = false
    closing = false
  }
}

/// EmbeddingGemma 2 (text + vision) on LiteRT-LM for memory search; loaded on demand.
actor Embedder {
  static let shared = Embedder()
  private var engine: EmbeddingEngine?
  private var path: String?
  private var inUse = InUse()
  private var closing = false

  /// Call inside a model change (Models.embed does).
  func ensureLoaded(_ modelPath: String) async throws {
    if engine != nil, path == modelPath { return }
    await unload()
    if MemoryBudget.mustBeAlone() { await Llm.shared.unload() }
    let cache = Files.root.appendingPathComponent("embed-cache", isDirectory: true)
    try? FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    let e = EmbeddingEngine(
      config: EmbeddingEngineConfig(
        modelPath: modelPath, backend: .cpu(), visionBackend: .cpu(), cacheDir: cache.path))
    try await e.initialize()
    engine = e
    path = modelPath
  }

  /// Vectors for [texts], or nil when the model isn't loaded (unloaded since ensureLoaded).
  func embedIfLoaded(_ modelPath: String, _ texts: [String], _ dims: Int) async throws -> [[Double]]? {
    guard !closing, let e = engine, path == modelPath else { return nil }
    inUse.begin()
    defer { inUse.end() }
    let opts = EmbeddingOptions(normalize: true, outputSize: dims)
    var out: [[Double]] = []
    for t in texts {
      let r = try await e.computeEmbedding(contents: [.text(t)], options: opts)
      out.append(r.embedding.map { Double($0) })
    }
    return out
  }

  func embedImagesIfLoaded(_ modelPath: String, _ photos: [String], _ dims: Int) async throws
    -> [[Double]]?
  {
    guard !closing, let e = engine, path == modelPath else { return nil }
    inUse.begin()
    defer { inUse.end() }
    let opts = EmbeddingOptions(normalize: true, outputSize: dims)
    var out: [[Double]] = []
    for p in photos {
      let small = VisionText.prepare(p, maxEdge: 512, name: "embed-input.jpg")
      let data = try Data(contentsOf: URL(fileURLWithPath: small))
      let r = try await e.computeEmbedding(contents: [.imageData(data)], options: opts)
      out.append(r.embedding.map { Double($0) })
    }
    return out
  }

  /// Waits for vectors being made, then frees the model. Call through Models.unloadEmbedder, or
  /// inside a model change.
  func unload() async {
    closing = true
    while inUse.count > 0 {
      await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in inUse.waitingForIdle(c) }
    }
    engine = nil
    path = nil
    closing = false
  }
}
