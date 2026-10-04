import XCTest

final class DrillEnvironmentTests: XCTestCase {
    private let environment = ["JELLYFIN_URL": "http://127.0.0.1:8096/", "JELLYFIN_API_KEY": "test-only&value"]

    func testResolvesNestedURLsWithoutChangingTheSavedConfiguration() throws {
        let template: [String: Any] = [
            "inputUrl": "${JELLYFIN_URL}/Videos/fixture/stream?ApiKey=${JELLYFIN_API_KEY}",
            "tiers": [["playlistUrl": "${JELLYFIN_URL}/Videos/fixture/main.m3u8?ApiKey=${JELLYFIN_API_KEY}"]],
            "bandwidth": 4_000_000,
        ]
        let resolved = try XCTUnwrap(DrillEnvironment.resolve(template, environment: environment) as? [String: Any])
        XCTAssertEqual(resolved["inputUrl"] as? String, "http://127.0.0.1:8096/Videos/fixture/stream?ApiKey=test-only%26value")
        XCTAssertEqual((resolved["tiers"] as? [[String: String]])?.first?["playlistUrl"], "http://127.0.0.1:8096/Videos/fixture/main.m3u8?ApiKey=test-only%26value")
        XCTAssertEqual(resolved["bandwidth"] as? Int, 4_000_000)
        XCTAssertTrue((template["inputUrl"] as? String)?.contains("${JELLYFIN_API_KEY}") == true)
    }

    func testMissingOrEmptyCredentialsFailExplicitly() {
        for variables: [String: String] in [[:], ["JELLYFIN_API_KEY": ""]] {
            XCTAssertThrowsError(try DrillEnvironment.resolve("ApiKey=${JELLYFIN_API_KEY}", environment: variables)) {
                XCTAssertEqual($0 as? DrillEnvironment.ConfigurationError, .missingVariable("JELLYFIN_API_KEY"))
            }
        }
    }

    func testDiagnosticRecordsDoNotPersistCredentials() throws {
        let record = ["error": "ApiKey=test-only%26value", "nested": ["authorization": "test-only&value"]] as [String: Any]
        let redacted = DrillEnvironment.redact(record, environment: environment)
        let serialized = String(decoding: try JSONSerialization.data(withJSONObject: redacted), as: UTF8.self)
        XCTAssertFalse(serialized.contains("test-only"))
        XCTAssertTrue(serialized.contains("[REDACTED]"))
    }
}
