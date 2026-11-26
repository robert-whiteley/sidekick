import CryptoKit
import Foundation
import Security

/// App-private folders and file helpers for the iPhone build.
enum Files {
  /// Everything Sidekick keeps (models, personal data): Library/Application Support/sidekick,
  /// excluded from iCloud and computer backups so nothing leaves the phone that way (Android:
  /// allowBackup off). Deleting the app deletes it.
  static let root: URL = {
    let base =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSTemporaryDirectory())
    var dir = base.appendingPathComponent("sidekick", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)
    return dir
  }()

  /// Marks one file or folder as not backed up (the database lives outside [root]).
  static func excludeFromBackup(_ path: String) -> Bool {
    guard FileManager.default.fileExists(atPath: path) else { return false }
    var url = URL(fileURLWithPath: path)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    do {
      try url.setResourceValues(values)
      return true
    } catch {
      return false
    }
  }

  /// "Delete all my data": everything in [root] (database, photos, audio, models), the small
  /// settings, and the app's keychain items (the database key), like deleting the app would.
  static func wipeAll() -> Bool {
    let fm = FileManager.default
    var ok = true
    for item in (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [] {
      if (try? fm.removeItem(at: item)) == nil { ok = false }
    }
    let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
    for item in (try? fm.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil)) ?? [] {
      try? fm.removeItem(at: item)
    }
    let defaults = UserDefaults.standard
    for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("sidekick.") {
      defaults.removeObject(forKey: key)
    }
    for cls in [kSecClassGenericPassword, kSecClassKey] {
      SecItemDelete([kSecClass as String: cls] as CFDictionary)
    }
    return ok
  }

  static func isFile(_ path: String) -> Bool {
    var dir: ObjCBool = false
    return FileManager.default.fileExists(atPath: path, isDirectory: &dir) && !dir.boolValue
  }

  static func size(_ path: String) -> Double {
    let attrs = try? FileManager.default.attributesOfItem(atPath: path)
    return (attrs?[.size] as? NSNumber)?.doubleValue ?? 0
  }

  static func copy(_ src: String, _ dst: String) throws {
    let fm = FileManager.default
    let to = URL(fileURLWithPath: dst)
    try fm.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
    if fm.fileExists(atPath: dst) { try fm.removeItem(at: to) }
    try fm.copyItem(at: URL(fileURLWithPath: src), to: to)
  }

  static func delete(_ path: String) -> Bool {
    guard FileManager.default.fileExists(atPath: path) else { return false }
    return (try? FileManager.default.removeItem(atPath: path)) != nil
  }

  /// SHA-256 of a (multi-GB) file, read in 4 MB pieces.
  static func sha256(_ path: String) throws -> String {
    let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
      let chunk: Data? = try autoreleasepool { try handle.read(upToCount: 4 * 1024 * 1024) }
      guard let data = chunk, !data.isEmpty else { break }
      hasher.update(data: data)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  /// Same contract as Android: checks "<dest>.part" against [sha] and moves it to [dest].
  static func finishDownload(_ dest: String, _ sha: String) throws -> Bool {
    let part = dest + ".part"
    guard isFile(part) else { return isFile(dest) }
    let actual = try sha256(part)
    if actual.lowercased() != sha.lowercased() {
      _ = delete(part)
      return false
    }
    let fm = FileManager.default
    if fm.fileExists(atPath: dest) { try fm.removeItem(atPath: dest) }
    try fm.moveItem(atPath: part, toPath: dest)
    _ = excludeFromBackup(dest)
    return true
  }

  /// Data export: memory.json plus the original photos in one zip. iOS has no zip API, so the
  /// folder is zipped by the system file coordinator (the same thing the Files app does).
  static func exportZip(json: String, files: [String], destPath: String) throws -> String {
    let fm = FileManager.default
    let staging = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("sidekick-export-\(UUID().uuidString)", isDirectory: true)
    let folder = staging.appendingPathComponent("Sidekick export", isDirectory: true)
    let photos = folder.appendingPathComponent("photos", isDirectory: true)
    defer { try? fm.removeItem(at: staging) }
    try fm.createDirectory(at: photos, withIntermediateDirectories: true)
    try json.data(using: .utf8)?.write(to: folder.appendingPathComponent("memory.json"))
    for f in files where isFile(f) {
      let src = URL(fileURLWithPath: f)
      try? fm.copyItem(at: src, to: photos.appendingPathComponent(src.lastPathComponent))
    }
    var coordError: NSError?
    var copyError: Error?
    NSFileCoordinator().coordinate(readingItemAt: folder, options: [.forUploading], error: &coordError) {
      zipURL in
      do {
        try copy(zipURL.path, destPath)
      } catch {
        copyError = error
      }
    }
    if let e = coordError { throw e }
    if let e = copyError { throw e }
    return destPath
  }
}
