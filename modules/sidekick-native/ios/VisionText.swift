import Foundation
import ImageIO
import PDFKit
import UIKit
import UniformTypeIdentifiers
import Vision

/// Photo text (OCR), QR codes and PDF pages with Apple's on-device Vision and PDFKit. Nothing is
/// sent anywhere; no model download is needed on the iPhone (Android uses PP-OCRv6 and ZXing).
enum VisionText {
  struct Line {
    let text: String
    let score: Float
  }

  /// Reads a photo upright (EXIF orientation applied) and no larger than [maxEdge] px.
  static func loadImage(_ path: String, maxEdge: Int) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else {
      return nil
    }
    let opts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxEdge,
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
  }

  /// A JPEG copy no larger than [maxEdge] px for the chat model / embedder (like ModelImage.kt).
  static func prepare(_ path: String, maxEdge: Int, name: String) -> String {
    guard let img = loadImage(path, maxEdge: maxEdge) else { return path }
    let out = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
    try? FileManager.default.removeItem(at: out)
    guard
      let dest = CGImageDestinationCreateWithURL(
        out as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { return path }
    CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    return CGImageDestinationFinalize(dest) ? out.path : path
  }

  /// Text lines top to bottom, left to right.
  static func read(_ image: CGImage) throws -> [Line] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let found = (request.results ?? []).compactMap { obs -> (CGRect, Line)? in
      guard let best = obs.topCandidates(1).first else { return nil }
      return (obs.boundingBox, Line(text: best.string, score: best.confidence))
    }
    // Vision's boxes start at the bottom left: higher y is nearer the top.
    let sorted = found.sorted { a, b in
      if abs(a.0.midY - b.0.midY) > min(a.0.height, b.0.height) / 2 { return a.0.midY > b.0.midY }
      return a.0.minX < b.0.minX
    }
    return sorted.map { $0.1 }
  }

  static func readPhoto(_ path: String) throws -> [Line] {
    guard let img = loadImage(path, maxEdge: 2048) else {
      throw NSError(
        domain: "Sidekick", code: 1, userInfo: [NSLocalizedDescriptionKey: "Can't open the photo"])
    }
    return try read(img)
  }

  /// QR codes and barcodes as a JSON array of {format, text}, formats named like ZXing's.
  static func scanCodes(_ path: String) throws -> String {
    guard let img = loadImage(path, maxEdge: 2048) else { return "[]" }
    let request = VNDetectBarcodesRequest()
    try VNImageRequestHandler(cgImage: img, options: [:]).perform([request])
    var out: [[String: String]] = []
    var seen = Set<String>()
    for obs in request.results ?? [] {
      guard let text = obs.payloadStringValue, !seen.contains(text) else { continue }
      seen.insert(text)
      out.append(["format": formatName(obs.symbology), "text": text])
    }
    let data = try JSONSerialization.data(withJSONObject: out)
    return String(data: data, encoding: .utf8) ?? "[]"
  }

  private static func formatName(_ s: VNBarcodeSymbology) -> String {
    switch s {
    case .qr: return "QR_CODE"
    case .aztec: return "AZTEC"
    case .dataMatrix: return "DATA_MATRIX"
    case .pdf417: return "PDF_417"
    case .ean13: return "EAN_13"
    case .ean8: return "EAN_8"
    case .upce: return "UPC_E"
    case .code128: return "CODE_128"
    case .code39: return "CODE_39"
    case .code93: return "CODE_93"
    case .itf14: return "ITF"
    default: return s.rawValue
    }
  }

  private static func pdf(_ uri: String) -> PDFDocument? {
    let url = uri.hasPrefix("file://") ? URL(string: uri) : URL(fileURLWithPath: uri)
    return url.flatMap { PDFDocument(url: $0) }
  }

  /// Page count and the embedded text of page [index] (nil when the page has none).
  static func pdfPageText(_ uri: String, _ index: Int) -> [String: Any] {
    guard let doc = pdf(uri) else { return ["pages": 0, "text": NSNull()] }
    var out: [String: Any] = ["pages": doc.pageCount, "text": NSNull()]
    if index < doc.pageCount, let text = doc.page(at: index)?.string, !text.isEmpty {
      out["text"] = text
    }
    return out
  }

  /// Page [index] rendered at 1600 px and read with Vision (for scans).
  static func pdfPageOcr(_ uri: String, _ index: Int) throws -> [String] {
    guard let doc = pdf(uri), index < doc.pageCount, let page = doc.page(at: index) else { return [] }
    let box = page.bounds(for: .mediaBox)
    let scale = 1600 / max(box.width, box.height, 1)
    let thumb = page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
    guard let img = thumb.cgImage else { return [] }
    return try read(img).map { $0.text }
  }
}
