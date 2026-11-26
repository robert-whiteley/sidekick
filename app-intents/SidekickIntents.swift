import AppIntents
internal import ExpoAppIntents

// iPhone quick access (Siri, the Shortcuts app, the Action Button, a Shortcut control in Control
// Center). Each intent opens Sidekick and hands the request to JavaScript
// (src/engine/app-intents.ts); the answer is shown and spoken in the app, since iOS doesn't let
// an app keep listening or run the model in the background. Compiled into the app target by
// expo-app-intents (Apple only reads App Shortcuts from the app target, not from pods).

/// "Ask Sidekick": Siri asks for the question, then Sidekick opens and answers it.
struct AskSidekickIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask Sidekick"
  static var description: IntentDescription {
    IntentDescription("Opens Sidekick and asks your question. The answer is worked out on this iPhone.")
  }
  static let openAppWhenRun: Bool = true

  @Parameter(title: "Question", requestValueDialog: "What do you want to ask?")
  var question: String

  static var parameterSummary: some ParameterSummary {
    Summary("Ask Sidekick \(\.$question)")
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(
      name: "ask", params: ["question": .string(question)])
    return .result()
  }
}

/// Opens Sidekick with the microphone on, as if the mic button had been tapped.
struct VoiceQuestionIntent: AppIntent {
  static let title: LocalizedStringResource = "Start voice question"
  static var description: IntentDescription {
    IntentDescription("Opens Sidekick and starts listening for your question.")
  }
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "listen")
    return .result()
  }
}

/// Opens Sidekick's camera for "What am I looking at?"; tapping send takes the photo.
struct LookIntent: AppIntent {
  static let title: LocalizedStringResource = "What am I looking at?"
  static var description: IntentDescription {
    IntentDescription("Opens Sidekick's camera. Take the photo and Sidekick tells you what it sees.")
  }
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await AppIntentDispatcher.shared.dispatch(name: "look")
    return .result()
  }
}

/// Siri phrases and the actions shown in the Shortcuts app and the Action Button picker.
/// Plain literals: Apple reads these at build time (compile-time constants).
struct SidekickShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AskSidekickIntent(),
      phrases: [
        "Ask \(.applicationName)",
        "Ask \(.applicationName) a question",
      ],
      shortTitle: "Ask Sidekick",
      systemImageName: "bubble.left"
    )
    AppShortcut(
      intent: VoiceQuestionIntent(),
      phrases: [
        "Talk to \(.applicationName)",
        "Start a voice question in \(.applicationName)",
      ],
      shortTitle: "Voice question",
      systemImageName: "mic"
    )
    AppShortcut(
      intent: LookIntent(),
      phrases: [
        "What am I looking at in \(.applicationName)",
        "Open the \(.applicationName) camera",
      ],
      shortTitle: "What am I looking at?",
      systemImageName: "camera"
    )
  }
}
