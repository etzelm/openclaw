// Prints the CGWindowID of the largest on-screen normal window owned by the
// named process, for `screencapture -l`. Usage: window-id <owner-name|pid>
// A numeric argument matches the owner pid, so a PR build is not confused with
// another app of the same name.
import CoreGraphics
import Foundation

let owner = CommandLine.arguments.dropFirst().first ?? "OpenClaw"
let ownerPid = Int(owner)
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}

var best: (id: Int, area: Double)?
for window in windows {
    let ownerMatches = ownerPid.map { (window[kCGWindowOwnerPID as String] as? Int) == $0 }
        ?? ((window[kCGWindowOwnerName as String] as? String) == owner)
    guard ownerMatches,
          (window[kCGWindowLayer as String] as? Int) == 0,
          let id = window[kCGWindowNumber as String] as? Int,
          let bounds = window[kCGWindowBounds as String] as? [String: Double]
    else { continue }
    let area = (bounds["Width"] ?? 0) * (bounds["Height"] ?? 0)
    if area > (best?.area ?? 0) {
        best = (id, area)
    }
}

guard let best else { exit(1) }
print(best.id)
