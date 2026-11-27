import Foundation
import ImageIO
import Photos
import UIKit
import UniformTypeIdentifiers

/// Phone search on the iPhone: a small upright JPEG copy of a photo the user allowed (a Photos
/// library item, "ph://<id>", or a file), with its date and place, for on-device text reading
/// and the photo vector. Photos kept only in iCloud are skipped: nothing is downloaded.
enum Gallery {
  static func prepare(_ ref: String, maxEdge: Int, outPath: String) async -> [String: Any]? {
    let out = URL(fileURLWithPath: outPath)
    try? FileManager.default.createDirectory(
      at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: out)
    if ref.hasPrefix("ph://") {
      let id = String(ref.dropFirst("ph://".count))
      guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject
      else { return nil }
      guard let image = await requestImage(asset, maxEdge: maxEdge),
        let data = image.jpegData(compressionQuality: 0.88),
        (try? data.write(to: out)) != nil
      else { return nil }
      var r: [String: Any] = [
        "path": out.path,
        "width": Int(image.size.width * image.scale),
        "height": Int(image.size.height * image.scale),
      ]
      if let loc = asset.location {
        r["lat"] = loc.coordinate.latitude
        r["lon"] = loc.coordinate.longitude
      }
      if let d = asset.creationDate { r["takenAt"] = d.timeIntervalSince1970 * 1000 }
      return r
    }
    let path = ref.hasPrefix("file://") ? (URL(string: ref)?.path ?? ref) : ref
    guard let img = VisionText.loadImage(path, maxEdge: maxEdge),
      let dest = CGImageDestinationCreateWithURL(
        out as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      dest, img, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return ["path": out.path, "width": img.width, "height": img.height]
  }

  /// The photo at most [maxEdge] px, from this iPhone only (no iCloud download).
  private static func requestImage(_ asset: PHAsset, maxEdge: Int) async -> UIImage? {
    let opts = PHImageRequestOptions()
    opts.isNetworkAccessAllowed = false
    opts.deliveryMode = .highQualityFormat
    opts.resizeMode = .exact
    opts.isSynchronous = false
    let size = CGSize(width: maxEdge, height: maxEdge)
    return await withCheckedContinuation { (cont: CheckedContinuation<UIImage?, Never>) in
      var done = false
      PHImageManager.default().requestImage(
        for: asset, targetSize: size, contentMode: .aspectFit, options: opts
      ) { image, info in
        // High-quality delivery calls back once; guard anyway so the continuation resumes once.
        if done { return }
        let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
        if degraded && image != nil { return }
        done = true
        cont.resume(returning: image)
      }
    }
  }
}
