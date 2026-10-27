/**
 * Phase-4 iOS acceptance proof: a start attempt out of the UI surfaces the
 * typed engine gate verbatim. The engines are intentionally unavailable on
 * iOS this phase (G1 license carry-in / G2 no Go toolchain) — the UI must
 * show the exact `ERR_ENGINE_UNAVAILABLE: <reason>` wording from the module,
 * and never a connected state.
 *
 * Runs under `xcodebuild test -scheme OpenTunnel` (host-side permissions are
 * not required: the runner taps inside the simulator).
 */
import XCTest

final class OpenTunnelUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testConnectSurfacesEngineUnavailableVerbatim() throws {
        let app = XCUIApplication()
        app.launch()

        // The server cache badge ("N cached") proves the fetch + cache layer
        // ran; VPN Gate is documented slow (15 s connect + 120 s data-gap on
        // a ~1.3 MB payload), so the bound is generous.
        //
        // The runner sees a merged accessibility shape here: RN folds each
        // home Row into a single Button, so the badge is part of the servers
        // row's combined label ("…, 60 cached"), not a standalone
        // StaticText. Match any Button carrying a "<n> cached" count.
        let cachedBadge = app.buttons.matching(
            NSPredicate(format: "label MATCHES %@", ".*\\d+ cached.*")
        ).firstMatch
        if !cachedBadge.waitForExistence(timeout: 60) {
            // Diagnostic: capture the accessibility tree the runner actually
            // sees plus the pixels on screen, then fail honestly.
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "ax-tree-at-failure"
            tree.lifetime = .keepAlways
            add(tree)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "screen-at-failure"
            shot.lifetime = .keepAlways
            add(shot)
            XCTFail("the server list never cached (see ax-tree-at-failure)")
        }

        // Shield tap out of disconnected = auto-select the fastest cached
        // relay and start it — the start attempt hits the typed engine gate.
        // The shield row is one merged Button whose label starts with the
        // status readout ("Connection: Not connected. …").
        let shieldAction = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Connection:")
        ).firstMatch
        XCTAssertTrue(shieldAction.waitForExistence(timeout: 30))
        shieldAction.tap()

        // The snapshot message must surface verbatim in the UI. Search every
        // element type: the Notice may render as a bare StaticText or as a
        // merged accessible element depending on its content.
        let gate = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "ERR_ENGINE_UNAVAILABLE")
        ).firstMatch
        if !gate.waitForExistence(timeout: 90) {
            // Diagnostic: capture the accessibility tree the runner actually
            // sees plus the pixels on screen, then fail honestly.
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "ax-tree-at-gate-failure"
            tree.lifetime = .keepAlways
            add(tree)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "screen-at-gate-failure"
            shot.lifetime = .keepAlways
            add(shot)
            XCTFail("the engine-unavailable error never surfaced in the UI")
            return
        }
        XCTAssertTrue(
            gate.label.contains(
                "ERR_ENGINE_UNAVAILABLE: openvpn engine unavailable on iOS: "
                    + "ics-openvpn port is gated pending the GPLv2 license decision (G1)"
            ),
            "unexpected verbatim wording: \(gate.label)"
        )

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "ios-engine-unavailable"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
