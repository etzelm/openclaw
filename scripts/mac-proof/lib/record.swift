// Records only one app's windows with ScreenCaptureKit until SIGINT/SIGTERM or
// a time cap, then finalizes the movie. Usage: record <pid> <out.mov> <max-seconds>
// screencapture -v cannot be stopped from a script without losing the file, and a
// full-screen or rect recording can include other apps on a personal machine.
import AppKit
import AVFoundation
import Foundation
import ScreenCaptureKit

guard CommandLine.arguments.count >= 4,
      let pid = Int32(CommandLine.arguments[1]),
      let maxSeconds = Double(CommandLine.arguments[3])
else {
    FileHandle.standardError.write("usage: record <pid> <out.mov> <max-seconds>\n".data(using: .utf8)!)
    exit(2)
}
let outURL = URL(fileURLWithPath: CommandLine.arguments[2])

final class Recorder: NSObject, SCRecordingOutputDelegate, SCStreamDelegate {
    var stream: SCStream?
    let finished = DispatchSemaphore(value: 0)
    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) { finished.signal() }
    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: any Error) {
        FileHandle.standardError.write("recording failed: \(error)\n".data(using: .utf8)!)
        finished.signal()
    }
    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        FileHandle.standardError.write("stream stopped: \(error)\n".data(using: .utf8)!)
        finished.signal()
    }
}

let recorder = Recorder()
let started = DispatchSemaphore(value: 0)
var startError: Error?

Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let app = content.applications.first(where: { $0.processID == pid }) else {
            throw NSError(domain: "record", code: 1, userInfo: [NSLocalizedDescriptionKey: "pid \(pid) has no shareable app"])
        }
        let windows = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }
        guard let main = windows.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }),
              let display = content.displays.first(where: { $0.frame.intersects(main.frame) }) ?? content.displays.first
        else { throw NSError(domain: "record", code: 2, userInfo: [NSLocalizedDescriptionKey: "no window for pid \(pid)"]) }
        // Only this app's windows; everything else on the display is left out.
        let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
        let config = SCStreamConfiguration()
        let scale = Double(filter.pointPixelScale)
        config.sourceRect = CGRect(x: main.frame.minX - display.frame.minX, y: main.frame.minY - display.frame.minY,
                                   width: main.frame.width, height: main.frame.height)
        config.width = Int(main.frame.width * scale)
        config.height = Int(main.frame.height * scale)
        config.showsCursor = true
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        let stream = SCStream(filter: filter, configuration: config, delegate: recorder)
        let outConfig = SCRecordingOutputConfiguration()
        outConfig.outputURL = outURL
        outConfig.outputFileType = .mov
        try stream.addRecordingOutput(SCRecordingOutput(configuration: outConfig, delegate: recorder))
        try await stream.startCapture()
        recorder.stream = stream
    } catch {
        startError = error
    }
    started.signal()
}
started.wait()
if let startError {
    FileHandle.standardError.write("start failed: \(startError)\n".data(using: .utf8)!)
    exit(1)
}
print("recording pid \(pid) to \(outURL.path)")

func stopAndExit() {
    Task {
        try? await recorder.stream?.stopCapture()
    }
    _ = recorder.finished.wait(timeout: .now() + 15)
    exit(0)
}
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let sources = [SIGINT, SIGTERM].map { sig -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
    source.setEventHandler { stopAndExit() }
    source.resume()
    return source
}
DispatchQueue.global().asyncAfter(deadline: .now() + maxSeconds) { stopAndExit() }
// ScreenCaptureKit touches AppKit on the main thread; run a real (hidden) app loop.
withExtendedLifetime(sources) {
    NSApplication.shared.setActivationPolicy(.prohibited)
    NSApplication.shared.run()
}
