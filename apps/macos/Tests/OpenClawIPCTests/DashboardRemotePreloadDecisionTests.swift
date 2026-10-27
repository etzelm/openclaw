import Testing
@testable import OpenClaw

struct DashboardRemotePreloadDecisionTests {
    private func decision(
        pending: Bool = true,
        mode: AppState.ConnectionMode = .remote,
        channelConnected: Bool = true,
        mainTargetIsPrimary: Bool = true,
        hasController: Bool = false,
        presentationInFlight: Bool = false) -> DashboardRemotePreloadDecision
    {
        DashboardRemotePreloadDecision(
            pending: pending,
            mode: mode,
            channelConnected: channelConnected,
            mainTargetIsPrimary: mainTargetIsPrimary,
            hasController: hasController,
            presentationInFlight: presentationInFlight)
    }

    @Test func `armed remote preload starts once the control channel is authenticated`() {
        #expect(self.decision() == .start)
    }

    @Test func `armed remote preload waits while the control channel is not authenticated`() {
        #expect(self.decision(channelConnected: false) == .wait)
    }

    @Test func `preload is discarded when it was never armed`() {
        #expect(self.decision(pending: false) == .discard)
    }

    @Test(arguments: [AppState.ConnectionMode.local, .unconfigured])
    func `preload is discarded outside remote mode`(_ mode: AppState.ConnectionMode) {
        #expect(self.decision(mode: mode) == .discard)
        #expect(self.decision(mode: mode, channelConnected: false) == .discard)
    }

    @Test func `preload is discarded once the user owns the dashboard`() {
        #expect(self.decision(hasController: true) == .discard)
        #expect(self.decision(presentationInFlight: true) == .discard)
        #expect(self.decision(mainTargetIsPrimary: false) == .discard)
        #expect(self.decision(channelConnected: false, presentationInFlight: true) == .discard)
    }
}
