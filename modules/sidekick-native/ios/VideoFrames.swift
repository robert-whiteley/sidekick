import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A few still pictures from a video, evenly spread through it, as JPEGs no larger than
/// [maxEdge] px for the chat model to describe (like VideoFrames.kt on Android).
enum VideoFrames {
  static func extract(_ path: String, _ count: Int, _ outDir: String, _ maxEdge: Int) async throws
    -> [String: Any]
  {
    let url = path.hasPrefix("file://") ? (URL(string: path) ?? URL(fileURLWithPath: path))
      : URL(fileURLWithPath: path)
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration)
    let durationMs = duration.isNumeric ? CMTimeGetSeconds(duration) * 1000 : 0
    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true
    gen.maximumSize = CGSize(width: maxEdge, height: maxEdge)
    let n = min(max(count, 1), 8)
    try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    var frames: [[String: Any]] = []
    for i in 0..<n {
      let atMs = durationMs > 0 ? durationMs * Double(2 * i + 1) / Double(2 * n) : 0
      let time = CMTime(seconds: atMs / 1000, preferredTimescale: 600)
      guard let picked = try? await gen.image(at: time) else { continue }
      let out = URL(fileURLWithPath: outDir).appendingPathComponent("frame\(i).jpg")
      try? FileManager.default.removeItem(at: out)
      guard
        let dest = CGImageDestinationCreateWithURL(
          out as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
      else { continue }
      CGImageDestinationAddImage(
        dest, picked.image, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
      if CGImageDestinationFinalize(dest) { frames.append(["path": out.path, "atMs": atMs]) }
    }
    return ["durationMs": durationMs, "frames": frames]
  }
}
