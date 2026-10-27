// Reports whether this process tree may capture the screen and post events,
// so a missing TCC grant fails preflight instead of yielding wallpaper-only
// captures. Exits 1 when either grant is missing. Usage: tcc-check
import ApplicationServices
import CoreGraphics
import Foundation

let screen = CGPreflightScreenCaptureAccess()
let accessibility = AXIsProcessTrusted()
print("screenCapture=\(screen) accessibility=\(accessibility)")
exit(screen && accessibility ? 0 : 1)
