import AppKit
import Foundation
import Testing
@testable import OpenClaw

/// Hands each primary lookup its own gate, so a test can resume them in order.
private actor DashboardRemotePreloadLookups {
    private let gates: [DashboardWindowOwnershipPresentationGate]
    private var started = 0

    init(_ gates: [DashboardWindowOwnershipPresentationGate]) {
        self.gates = gates
    }

    func waitForRelease() async {
        let gate = self.gates[min(self.started, self.gates.count - 1)]
        self.started += 1
        await gate.waitForRelease()
    }
}

@Suite(.serialized, .testWaitLimit)
@MainActor
struct DashboardRemotePreloadTests {
    private func remoteManager(
        server: DashboardHTTPFixture,
        lookupGates: [DashboardWindowOwnershipPresentationGate]) -> DashboardManager
    {
        let lookups = DashboardRemotePreloadLookups(lookupGates)
        return DashboardManager._testMake(primaryEndpointProvider: { _ in
            await lookups.waitForRelease()
            return GatewayConnection.EndpointSnapshot(
                config: (url: server.websocketURL(), token: "primary", password: nil), routeAuthority: nil)
        })
    }

    /// Runs `body` as a remote-mode launch after onboarding, the state the menu bar preload sees.
    private func withRemoteLaunch(_ body: () async throws -> Void) async throws {
        // Window lookups read NSApp; create it here instead of relying on test order.
        _ = NSApplication.shared
        let state = AppStateStore.shared
        let originalMode = state.connectionMode
        let originalOnboarding = state.onboardingSeen
        state.connectionMode = .remote
        state.onboardingSeen = true
        defer {
            state.connectionMode = originalMode
            state.onboardingSeen = originalOnboarding
        }
        try await body()
    }

    @Test func `first open reuses the hidden remote preload document`() async throws {
        try await TestIsolation.withIsolatedState { try await self.withRemoteLaunch {
            let server = try await DashboardHTTPFixture.start()
            defer { server.stop() }
            let lookupGate = DashboardWindowOwnershipPresentationGate(released: true)
            let manager = self.remoteManager(server: server, lookupGates: [lookupGate])
            defer { manager.close() }
            manager.testControlChannelConnected = true

            await manager.preloadIfConfigured()?.value
            let preloaded = try #require(manager._testController())
            #expect(!preloaded.isWindowOpen)
            // Native sign-in challenges are answered only for retained windows.
            #expect(preloaded.hasRetainedWindow)
            #expect(preloaded.documentHost.isNativeAuthAvailable())

            try await manager.show()

            #expect(manager._testController() === preloaded)
            #expect(preloaded.isWindowOpen)
            #expect(!preloaded.isHiddenForExperience)
            #expect(preloaded.auth.token == "primary")
        } }
    }

    @Test func `open in flight before authentication owns the first document`() async throws {
        try await TestIsolation.withIsolatedState { try await self.withRemoteLaunch {
            let server = try await DashboardHTTPFixture.start()
            defer { server.stop() }
            let lookupGate = DashboardWindowOwnershipPresentationGate()
            let manager = self.remoteManager(server: server, lookupGates: [lookupGate])
            defer { manager.close() }
            manager.testControlChannelConnected = false
            #expect(manager.preloadIfConfigured() == nil)

            let opening = manager.openOrFocusDashboard(for: .primary)
            await lookupGate.waitUntilRequested()
            manager.testControlChannelConnected = true
            await manager._testHandleControlChannelStateChange(.connected)
            await lookupGate.release()
            await opening.value

            // A preload that started here would install a hidden controller first
            // and make the open's ownership guard drop its window.
            let opened = try #require(manager._testController())
            #expect(opened.isWindowOpen)
        } }
    }

    @Test func `open that starts during the preload lookup owns the first document`() async throws {
        try await TestIsolation.withIsolatedState { try await self.withRemoteLaunch {
            let server = try await DashboardHTTPFixture.start()
            defer { server.stop() }
            let preloadLookup = DashboardWindowOwnershipPresentationGate()
            let openLookup = DashboardWindowOwnershipPresentationGate()
            let manager = self.remoteManager(server: server, lookupGates: [preloadLookup, openLookup])
            defer { manager.close() }
            manager.testControlChannelConnected = true

            let preload = try #require(manager.preloadIfConfigured())
            await preloadLookup.waitUntilRequested()
            let opening = manager.openOrFocusDashboard(for: .primary)
            await openLookup.waitUntilRequested()
            // The preload finishes its lookup first, while the open still waits on its own.
            await preloadLookup.release()
            await preload.value
            #expect(manager._testController() == nil)
            await openLookup.release()
            await opening.value

            let opened = try #require(manager._testController())
            #expect(opened.isWindowOpen)
        } }
    }

    @Test func `hidden remote preload follows an endpoint change before the first open`() async throws {
        try await TestIsolation.withIsolatedState { try await self.withRemoteLaunch {
            let server = try await DashboardHTTPFixture.start()
            defer { server.stop() }
            let replacementServer = try await DashboardHTTPFixture.start()
            defer { replacementServer.stop() }
            let lookupGate = DashboardWindowOwnershipPresentationGate(released: true)
            let manager = self.remoteManager(server: server, lookupGates: [lookupGate])
            defer { manager.close() }
            manager.testControlChannelConnected = true
            await manager.preloadIfConfigured()?.value
            let preloadedWindow = try #require(manager._testController()?.window)

            await manager.handleEndpointState(.ready(
                mode: .remote,
                url: replacementServer.websocketURL(),
                token: "rotated-primary-token",
                password: nil,
                routeRevision: 2))

            let reconciled = try #require(manager._testController())
            #expect(reconciled.auth.token == "rotated-primary-token")
            #expect(reconciled.window === preloadedWindow)
            #expect(!reconciled.isWindowOpen)
            #expect(reconciled.hasRetainedWindow)
        } }
    }
}
