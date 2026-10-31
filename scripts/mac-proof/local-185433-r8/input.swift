// input click <x> <y> | input key : posts real HID events.
import CoreGraphics
import Foundation
let a = Array(CommandLine.arguments.dropFirst())
let source = CGEventSource(stateID: .hidSystemState)
if a.first == "key" {
    for down in [true, false] {
        CGEvent(keyboardEventSource: source, virtualKey: 0x00, keyDown: down)!.post(tap: .cghidEventTap)
        usleep(60_000)
    }
    exit(0)
}
let p = CGPoint(x: Double(a[1])!, y: Double(a[2])!)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap)
    usleep(type == .mouseMoved ? 150_000 : 60_000)
}
