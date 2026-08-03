import Foundation
import TVServices

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

  /// Mirrors STORAGE_KEYS in services/jellyfinApi.ts.
  private enum StorageKey {
    static let serverURL = "jellyfin_server_url"
    static let apiKey = "jellyfin_api_key"
    static let userId = "jellyfin_user_id"
    static let deviceId = "jellyfin_device_id"
  }

  // MARK: - TVTopShelfContentProvider

  override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
    guard
      let server = Self.keychainString(forKey: StorageKey.serverURL), !server.isEmpty,
      let apiKey = Self.keychainString(forKey: StorageKey.apiKey), !apiKey.isEmpty,
      let userId = Self.keychainString(forKey: StorageKey.userId), !userId.isEmpty
    else {
      completionHandler(nil)
      return
    }

    let base = server.hasSuffix("/") ? String(server.dropLast()) : server
    guard let url = URL(string: "\(base)/Users/\(userId)/Items/Resume?Limit=10&Fields=PrimaryImageAspectRatio&EnableUserData=true&MediaTypes=Video") else {
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

    URLSession.shared.dataTask(with: request) { data, response, _ in
      guard
        let data = data,
        let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let payload = try? JSONDecoder().decode(ResumeResponse.self, from: data),
        let items = payload.Items, !items.isEmpty
      else {
        completionHandler(nil)
        return
      }

      let shelfItems = items.map { Self.makeShelfItem($0, base: base, apiKey: apiKey) }
      let section = TVTopShelfItemCollection(items: shelfItems)
      section.title = "Continue Watching"
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

    // Match the in-app grid: landscape art gets the 16:9 slot, everything else a poster.
    shelfItem.imageShape = (item.PrimaryImageAspectRatio ?? 0) >= 1 ? .hdtv : .poster

    // Same formula as components/continue-watching-row.tsx.
    if let runtime = item.RunTimeTicks, runtime > 0 {
      shelfItem.playbackProgress = min(max((item.UserData?.PlaybackPositionTicks ?? 0) / runtime, 0), 1)
    } else if let percentage = item.UserData?.PlayedPercentage {
      shelfItem.playbackProgress = min(max(percentage / 100, 0), 1)
    }

    // Poster URL shape mirrors getPosterUrl() in services/jellyfinApi.ts. The SYSTEM
    // downloads these (not this process), so no image bytes ever enter the extension.
    if let image1x = URL(string: "\(base)/Items/\(item.Id)/Images/Primary?api_key=\(apiKey)&maxHeight=720&quality=90") {
      shelfItem.setImageURL(image1x, for: .screenScale1x)
    }
    if let image2x = URL(string: "\(base)/Items/\(item.Id)/Images/Primary?api_key=\(apiKey)&maxHeight=1440&quality=90") {
      shelfItem.setImageURL(image2x, for: .screenScale2x)
    }

    // tomotv:///player?videoId=... — handled by expo-router via the app's URL scheme.
    // BOTH actions must be set or selecting the card does nothing (Apple forums 22073).
    var link = URLComponents()
    link.scheme = "tomotv"
    link.host = ""
    link.path = "/player"
    link.queryItems = [
      URLQueryItem(name: "videoId", value: item.Id),
      URLQueryItem(name: "videoName", value: name),
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
  let UserData: ResumeUserData?

  // "Type" is the Jellyfin field name but is reserved as a Swift member name.
  private enum CodingKeys: String, CodingKey {
    case Id, Name, SeriesName, RunTimeTicks, PrimaryImageAspectRatio, UserData
    case itemType = "Type"
  }
}

private struct ResumeUserData: Decodable {
  let PlaybackPositionTicks: Double?
  let PlayedPercentage: Double?
}
