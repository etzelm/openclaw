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
        let manager = DashboardManager._testMake(primaryEndpointProvider: { _ in
            await lookups.waitForRelease()
            return GatewayConnection.EndpointSnapshot(
                config: (url: server.websocketURL(), token: "primary", password: nil), routeAuthority: nil)
        })
        return manager
    }

    @Test func `first open reuses the hidden remote preload document`() async throws {
        try await TestIsolation.withIsolatedState {
            let server = try await DashboardHTTPFixture.start()
            defer { server.stop() }
            let state = AppStateStore.shared
            let originalMode = state.connectionMode
            state.connectionMode = .remote
            defer { state.connectionMode = originalMode }
            let lookupGate = DashboardWindowOwnershipPresentationGate(released: true)
            let manager = self.remoteManager(server: server, lookupGates: [lookupGate])
            defer { manager.close() }
            manager.testControlChannelConnected = true

            manager._testArmRemotePreload()
            try await TestWait.state("hidden preload controller") { manager._testController() != nil }
            let preloaded = try #require(manager._testController())
            #expect(!preloaded.isWindowOpen)

            try await manager.show()

            #expect(manager._testController() === preloaded)
            #expect(preloaded.isWindowOpen)
            #expect(preloaded.auth.token == "primary")
        }
    }

    @Test func `open in flight before authentication owns the first document`() async throws {
        try await TestIsolation.withIsolatedState {
            let server = try await DashboardHTTPFixture.start()
            defer { server.stop() }
            let state = AppStateStore.shared
            let originalMode = state.connectionMode
            state.connectionMode = .remote
            defer { state.connectionMode = originalMode }
            let lookupGate = DashboardWindowOwnershipPresentationGate()
            let manager = self.remoteManager(server: server, lookupGates: [lookupGate])
            defer { manager.close() }
            manager.testControlChannelConnected = false
            manager._testArmRemotePreload()

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
        }
    }

    @Test func `open that starts during the preload lookup owns the first document`() async throws {
        try await TestIsolation.withIsolatedState {
            let server = try await DashboardHTTPFixture.start()
            defer { server.stop() }
            let state = AppStateStore.shared
            let originalMode = state.connectionMode
            state.connectionMode = .remote
            defer { state.connectionMode = originalMode }
            let preloadLookup = DashboardWindowOwnershipPresentationGate()
            let openLookup = DashboardWindowOwnershipPresentationGate()
            let manager = self.remoteManager(server: server, lookupGates: [preloadLookup, openLookup])
            defer { manager.close() }
            manager.testControlChannelConnected = true

            let preload = manager._testArmRemotePreload()
            await preloadLookup.waitUntilRequested()
            let opening = manager.openOrFocusDashboard(for: .primary)
            await openLookup.waitUntilRequested()
            // The preload finishes its lookup first, while the open still waits on its own.
            await preloadLookup.release()
            await preload?.value
            #expect(manager._testController() == nil)
            await openLookup.release()
            await opening.value

            let opened = try #require(manager._testController())
            #expect(opened.isWindowOpen)
        }
    }
}
