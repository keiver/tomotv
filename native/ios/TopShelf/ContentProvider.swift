import Foundation
import TVServices
import os.log

/// Top Shelf "Continue Watching" provider.
///
/// Runs as a separate tvOS app-extension process. Reads the Jellyfin credentials the app
/// stores via expo-secure-store (shared keychain access group, see TopShelf.entitlements),
/// fetches the user's resume list, and returns a sectioned shelf with poster cards and
/// playback-progress bars. Every failure path returns nil, which makes tvOS fall back to
/// the static Top Shelf image from the app's brand assets.
///
/// Constraints (Apple): ~16 MB memory cap — never download image data here; hand the
/// system URLs via setImageURL and let it load them. Keep the single JSON fetch small.
class ContentProvider: TVTopShelfContentProvider {

  /// Diagnostic logging (Console.app: filter subsystem dev.keiver.tomotv.TopShelf).
  /// Logs presence/status only — never credential values.
  private static let log = Logger(subsystem: "dev.keiver.tomotv.TopShelf", category: "ContentProvider")

  /// Mirrors STORAGE_KEYS in services/jellyfinApi.ts.
  private enum StorageKey {
    static let serverURL = "jellyfin_server_url"
    static let apiKey = "jellyfin_api_key"
    static let userId = "jellyfin_user_id"
    static let deviceId = "jellyfin_device_id"
  }

  // MARK: - TVTopShelfContentProvider

  override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
    Self.log.info("loadTopShelfContent: queried by system")

    let serverValue = Self.keychainString(forKey: StorageKey.serverURL)
    let apiKeyValue = Self.keychainString(forKey: StorageKey.apiKey)
    let userIdValue = Self.keychainString(forKey: StorageKey.userId)
    Self.log.info("keychain: server=\(serverValue?.isEmpty == false, privacy: .public) apiKey=\(apiKeyValue?.isEmpty == false, privacy: .public) userId=\(userIdValue?.isEmpty == false, privacy: .public)")

    guard
      let server = serverValue, !server.isEmpty,
      let apiKey = apiKeyValue, !apiKey.isEmpty,
      let userId = userIdValue, !userId.isEmpty
    else {
      Self.log.error("credentials guard failed — returning nil (static image fallback)")
      completionHandler(nil)
      return
    }

    let base = server.hasSuffix("/") ? String(server.dropLast()) : server
    // ImageTags is requested explicitly (same as the app's fetchResumeItems Fields list):
    // it drives the has-poster check that decides between server art and the placeholder.
    // /UserItems/Resume, not the legacy /Users/{userId}/Items/Resume: that route is gone from
    // the published API spec (the app's TS side moved with it). Same response, verified against
    // 10.11.11 — byte-identical payloads for the same user.
    guard let url = URL(string: "\(base)/UserItems/Resume?userId=\(userId)&Limit=10&Fields=PrimaryImageAspectRatio%2CImageTags&EnableUserData=true&MediaTypes=Video") else {
      Self.log.error("URL build failed — returning nil")
      completionHandler(nil)
      return
    }

    let deviceId = Self.keychainString(forKey: StorageKey.deviceId) ?? "topshelf"
    let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"

    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    // Same MediaBrowser header shape as getAuthHeader() in services/jellyfinApi.ts.
    request.setValue(
      "MediaBrowser Client=\"TomoTV\", Device=\"TopShelf\", DeviceId=\"\(deviceId)\", Version=\"\(version)\", Token=\"\(apiKey)\"",
      forHTTPHeaderField: "Authorization"
    )

    URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        Self.log.error("fetch transport error: \(error.localizedDescription, privacy: .public)")
      }
      let status = (response as? HTTPURLResponse)?.statusCode ?? -1
      Self.log.info("fetch: status=\(status, privacy: .public) bytes=\(data?.count ?? -1, privacy: .public)")

      guard
        let data = data,
        let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let payload = try? JSONDecoder().decode(ResumeResponse.self, from: data),
        let items = payload.Items, !items.isEmpty
      else {
        Self.log.error("response guard failed (status/decode/empty) — returning nil (static image fallback)")
        completionHandler(nil)
        return
      }

      let shelfItems = items.map { Self.makeShelfItem($0, base: base, apiKey: apiKey) }
      let section = TVTopShelfItemCollection(items: shelfItems)
      section.title = "Continue Watching"
      Self.log.info("returning \(shelfItems.count, privacy: .public) Continue Watching items")
      completionHandler(TVTopShelfSectionedContent(sections: [section]))
    }.resume()
  }

  // MARK: - Item mapping

  private static func makeShelfItem(_ item: ResumeItem, base: String, apiKey: String) -> TVTopShelfSectionedItem {
    let shelfItem = TVTopShelfSectionedItem(identifier: item.Id)

    let name = item.Name ?? "Untitled"
    if item.itemType == "Episode", let series = item.SeriesName, !series.isEmpty {
      shelfItem.title = "\(series) · \(name)"
    } else {
      shelfItem.title = name
    }

    // Same formula as components/continue-watching-row.tsx.
    if let runtime = item.RunTimeTicks, runtime > 0 {
      shelfItem.playbackProgress = min(max((item.UserData?.PlaybackPositionTicks ?? 0) / runtime, 0), 1)
    } else if let percentage = item.UserData?.PlayedPercentage {
      shelfItem.playbackProgress = min(max(percentage / 100, 0), 1)
    }

    // Items without a Primary image get the bundled brand face instead: requesting
    // /Images/Primary for them just 404s (same ImageTags?.Primary check as the app's
    // hasPoster()), and a failed system image load leaves the shelf card blank.
    // The face is square, so the placeholder card declares .square whatever the
    // media's orientation; artful items snap to the in-app card shapes
    // (artworkSlotShape in constants/app.ts): poster below 0.85, square through
    // 1.25, 16:9 above.
    if item.ImageTags?["Primary"] != nil {
      let aspect = item.PrimaryImageAspectRatio ?? 0
      shelfItem.imageShape = aspect < 0.85 ? .poster : (aspect <= 1.25 ? .square : .hdtv)
      // Poster URL shape mirrors getPosterUrl() in services/jellyfinApi.ts. The SYSTEM
      // downloads these (not this process), so no image bytes ever enter the extension.
      if let image1x = URL(string: "\(base)/Items/\(item.Id)/Images/Primary?ApiKey=\(apiKey)&maxHeight=720&quality=90") {
        shelfItem.setImageURL(image1x, for: .screenScale1x)
      }
      if let image2x = URL(string: "\(base)/Items/\(item.Id)/Images/Primary?ApiKey=\(apiKey)&maxHeight=1440&quality=90") {
        shelfItem.setImageURL(image2x, for: .screenScale2x)
      }
    } else if let placeholder = Bundle.main.url(forResource: "TopShelfPlaceholder", withExtension: "png") {
      shelfItem.imageShape = .square
      shelfItem.setImageURL(placeholder, for: .screenScale1x)
      shelfItem.setImageURL(placeholder, for: .screenScale2x)
    }

    // tomotv:///player?videoId=... — handled by expo-router via the app's URL scheme.
    // BOTH actions must be set or selecting the card does nothing (Apple forums 22073).
    // `ts` is a launch nonce: deep links arrive as react-navigation NAVIGATE, which
    // reuses an already-mounted player and merges params — with an identical videoId
    // nothing would restart. A fresh ts makes the player's key change and remount.
    var link = URLComponents()
    link.scheme = "tomotv"
    link.host = ""
    link.path = "/player"
    link.queryItems = [
      URLQueryItem(name: "videoId", value: item.Id),
      URLQueryItem(name: "videoName", value: name),
      URLQueryItem(name: "ts", value: String(Int(Date().timeIntervalSince1970 * 1000))),
    ]
    if let linkURL = link.url {
      shelfItem.playAction = TVTopShelfAction(url: linkURL)
      shelfItem.displayAction = TVTopShelfAction(url: linkURL)
    }

    return shelfItem
  }

  // MARK: - Keychain

  /// Reads a string the app stored through expo-secure-store. Matches its exact storage
  /// shape, verified in SecureStoreModule.swift (node_modules): kSecClassGenericPassword,
  /// account = UTF-8 key name, service "app:no-auth" — `set()` always appends the suffix
  /// because `requireAuthentication` is a non-optional Bool, so every current write lands
  /// there. The bare "app" service holds only legacy entries; the module's own `get()`
  /// still checks it, so this reader does too. No explicit access group in the query —
  /// the search spans the groups this target is entitled to, which includes the app's
  /// default group where expo-secure-store items land.
  private static func keychainString(forKey key: String) -> String? {
    for service in ["app:no-auth", "app"] {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: Data(key.utf8),
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecReturnData as String: true,
      ]
      var result: AnyObject?
      if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
        let data = result as? Data,
        let value = String(data: data, encoding: .utf8) {
        return value
      }
    }
    return nil
  }
}

// MARK: - Jellyfin response models (subset of JellyfinVideoItem in types/jellyfin.ts)

private struct ResumeResponse: Decodable {
  let Items: [ResumeItem]?
}

private struct ResumeItem: Decodable {
  let Id: String
  let Name: String?
  let itemType: String?
  let SeriesName: String?
  let RunTimeTicks: Double?
  let PrimaryImageAspectRatio: Double?
  let ImageTags: [String: String]?
  let UserData: ResumeUserData?

  // "Type" is the Jellyfin field name but is reserved as a Swift member name.
  private enum CodingKeys: String, CodingKey {
    case Id, Name, SeriesName, RunTimeTicks, PrimaryImageAspectRatio, ImageTags, UserData
    case itemType = "Type"
  }
}

private struct ResumeUserData: Decodable {
  let PlaybackPositionTicks: Double?
  let PlayedPercentage: Double?
}
