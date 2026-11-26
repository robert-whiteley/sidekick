import AVFoundation
import Foundation
import Speech

/// Push-to-talk on the iPhone: Apple's speech recognizer, on the phone only
/// (requiresOnDeviceRecognition), so no audio is sent to Apple. Android uses Parakeet instead.
final class PushToTalk {
  static let shared = PushToTalk()

  private let queue = DispatchQueue(label: "dev.sidekick.ptt")
  private let audio = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var text = ""
  private var final = false
  private var startError: String?
  private var tapped = false
  /// Words so far while the user is still talking (onPartialTranscript).
  var onPartial: ((String) -> Void)?

  static func recognizer() -> SFSpeechRecognizer? {
    // The app speaks English for now; use the phone's English variant when it has one.
    let here = Locale.current.identifier
    let locale = here.hasPrefix("en") ? Locale(identifier: here) : Locale(identifier: "en-US")
    return SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  }

  /// True when speech can be turned into text on this phone without the internet.
  static func availableOffline() -> Bool {
    guard let r = recognizer() else { return false }
    return r.supportsOnDeviceRecognition
  }

  /// Asks for Speech Recognition access the first time; true when allowed.
  static func requestAccess(_ done: @escaping (Bool) -> Void) {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: done(true)
    case .notDetermined: SFSpeechRecognizer.requestAuthorization { done($0 == .authorized) }
    default: done(false)
    }
  }

  func start() {
    queue.async { self.begin() }
  }

  private func begin() {
    finishAudio()
    text = ""
    final = false
    startError = nil
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      startError =
        SFSpeechRecognizer.authorizationStatus() == .notDetermined
        ? "Allow Speech Recognition when asked, then try again."
        : "Speech Recognition is off for Sidekick. Turn it on in iPhone Settings → Sidekick."
      PushToTalk.requestAccess { _ in }
      return
    }
    guard let recognizer = PushToTalk.recognizer(), recognizer.isAvailable else {
      startError = "Speech recognition isn't available right now. Type your question instead."
      return
    }
    guard recognizer.supportsOnDeviceRecognition else {
      startError = "This iPhone can't turn speech into text offline. Type your question instead."
      return
    }
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      startError = "The microphone is busy: \(error.localizedDescription)"
      return
    }
    let input = audio.inputNode
    let format = input.outputFormat(forBus: 0)
    // No microphone access (or no input) gives an empty format; tapping it would crash.
    guard format.sampleRate > 0, format.channelCount > 0 else {
      startError = "Microphone permission is needed."
      return
    }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.requiresOnDeviceRecognition = true
    req.shouldReportPartialResults = true
    request = req
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      req.append(buffer)
    }
    tapped = true
    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      guard let self = self else { return }
      self.queue.async {
        if let r = result {
          self.text = r.bestTranscription.formattedString
          if r.isFinal { self.final = true } else { self.onPartial?(self.text) }
        }
        if error != nil { self.final = true }
      }
    }
    audio.prepare()
    do {
      try audio.start()
    } catch {
      startError = "Couldn't start the microphone: \(error.localizedDescription)"
      finishAudio()
    }
  }

  private func finishAudio() {
    if tapped {
      audio.inputNode.removeTap(onBus: 0)
      tapped = false
    }
    if audio.isRunning { audio.stop() }
    request?.endAudio()
  }

  /// Stops listening and returns what was said (waits up to 3 s for the final words).
  func stop(_ done: @escaping (Result<String, Error>) -> Void) {
    queue.async {
      if let e = self.startError {
        self.startError = nil
        return done(.failure(NSError(domain: "Sidekick", code: 4, userInfo: [NSLocalizedDescriptionKey: e])))
      }
      self.finishAudio()
      self.waitForFinal(deadline: Date().addingTimeInterval(3), done)
    }
  }

  private func waitForFinal(deadline: Date, _ done: @escaping (Result<String, Error>) -> Void) {
    if final || Date() > deadline || task == nil {
      let said = text
      task?.cancel()
      task = nil
      request = nil
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      return done(.success(said))
    }
    queue.asyncAfter(deadline: .now() + 0.1) { self.waitForFinal(deadline: deadline, done) }
  }

  /// Stops at once without a result (the app went away, Off).
  func cancel() {
    queue.async {
      self.finishAudio()
      self.task?.cancel()
      self.task = nil
      self.request = nil
    }
  }
}
