// Finds text in an image with Vision and prints the match's center in the
// image's pixel space: "<cx> <cy> <recognized text>". Usage: ocr <png> <needle>
// The PR build's Browser failure view is an AppKit subview of the tab's
// WKWebView, and WebKit does not expose such subviews to accessibility, so the
// scenarios read it from the window screenshot instead.
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 3,
      let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    FileHandle.standardError.write("usage: ocr <png> <needle>\n".data(using: .utf8)!)
    exit(2)
}
let needle = args[2].lowercased()
    .replacingOccurrences(of: "\u{2019}", with: "'")
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
let width = Double(cg.width), height = Double(cg.height)
for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let text = candidate.string
    let normalized = text.lowercased().replacingOccurrences(of: "\u{2019}", with: "'")
    guard normalized.contains(needle) else { continue }
    // Vision boxes are normalized with the origin at the bottom left.
    let box = observation.boundingBox
    let cx = (box.midX) * width
    let cy = (1 - box.midY) * height
    print(String(format: "%.0f %.0f %@", cx, cy, text))
    exit(0)
}
exit(1)
