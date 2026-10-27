// Posts a real left click (HID event tap) at global screen coordinates, so
// WebKit sees a trusted user gesture. Usage: click <x> <y>
import CoreGraphics
import Foundation

let args = CommandLine.arguments.dropFirst().compactMap(Double.init)
guard args.count == 2 else {
    FileHandle.standardError.write(Data("usage: click <x> <y>\n".utf8))
    exit(2)
}

let point = CGPoint(x: args[0], y: args[1])
let source = CGEventSource(stateID: .hidSystemState)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    let button: CGMouseButton = .left
    guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point,
                              mouseButton: button)
    else { exit(1) }
    event.post(tap: .cghidEventTap)
    usleep(type == .mouseMoved ? 150_000 : 60_000)
}
