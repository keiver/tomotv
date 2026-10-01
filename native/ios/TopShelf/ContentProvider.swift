import Foundation
import TVServices
import UIKit
import os.log

/// Top Shelf provider: Continue Watching and recently played live channels, one list.
///
/// Runs as a separate tvOS app-extension process. Reads the Jellyfin credentials the app
/// stores via expo-secure-store (shared keychain access group, see TopShelf.entitlements),
/// fetches the user's resume list and recently played channels, and returns a sectioned
/// shelf. With nothing to show, it returns nil, which makes tvOS fall back to the static
/// Top Shelf image from the app's brand assets.
///
/// Constraints (Apple): ~16 MB memory cap — never download image data here; hand the
/// system URLs via setImageURL and let it load them. Keep the JSON fetches small.
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

    // Recently played channels: the server stamps a channel's LastPlayedDate like any item's.
    var channelsRequest = request
    channelsRequest.url = URL(string: "\(base)/Items?userId=\(userId)&includeItemTypes=TvChannel&recursive=true&sortBy=DatePlayed&sortOrder=Descending&Limit=\(Self.limit)&Fields=PrimaryImageAspectRatio%2CImageTags&EnableUserData=true&enableTotalRecordCount=false")

    Self.fetchItems(request) { resume in
      Self.fetchItems(channelsRequest) { channels in
        // One list in last-played order, as the app's Continue Watching row reads; never-played channels sort last and drop out.
        let picked = (resume + channels.filter { $0.UserData?.LastPlayedDate != nil })
          .enumerated()
          .sorted { ($0.element.playedKey, -$0.offset) > ($1.element.playedKey, -$1.offset) }
          .prefix(Self.limit)
          .map(\.element)
        guard !picked.isEmpty else {
          Self.log.error("no items, returning nil (static image fallback)")
          completionHandler(nil)
          return
        }
        Self.channelCards(for: picked, base: base, apiKey: apiKey) { cards in
          let items = picked.map { Self.makeShelfItem($0, base: base, apiKey: apiKey, card: cards[$0.Id]) }
          Self.log.info("returning \(items.count, privacy: .public) items, \(cards.count, privacy: .public) channel cards")
          completionHandler(TVTopShelfSectionedContent(sections: [TVTopShelfItemCollection(items: items)]))
        }
      }
    }
  }

  private static let limit = 10

  // MARK: - Channel cards

  /// The card a channel logo sits on in the app (video-grid-item.tsx): #2C2C2E, logo contain-fit in a
  /// centred 70% x 50% box, RAISED_EDGE's top highlight and hairline. The shelf fills a 16:9 card by
  /// cropping, so a wide logo shows whole only on an image that is already 16:9.
  private static let cardSize = CGSize(width: 1280, height: 720)
  private static let cardVersion = 2

  /// The App Group container: the system process that draws the shelf cannot read this extension's own
  /// Caches (a card there renders blank, seen on device 2026-10-01). Same layout as NexusPVR's shelf.
  private static var cardDirectory: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.dev.keiver.tomotv")?
      .appendingPathComponent("Library/Caches/topshelf-cards", isDirectory: true)
  }

  /// Card files by channel id for the picked channels with a logo; a card made for the same logo is reused.
  private static func channelCards(for picked: [ShelfItemDTO], base: String, apiKey: String, completion: @escaping ([String: URL]) -> Void) {
    guard let directory = cardDirectory, (try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)) != nil else {
      completion([:])
      return
    }
    let wanted = picked.compactMap { item -> (id: String, file: URL, logo: URL)? in
      guard item.itemType == "TvChannel", let tag = item.ImageTags?["Primary"],
            let logo = URL(string: "\(base)/Items/\(item.Id)/Images/Primary?ApiKey=\(apiKey)&maxHeight=720&quality=90") else { return nil }
      // The render version keys the file too, so a card drawn by an older build is replaced.
      return (item.Id, directory.appendingPathComponent("\(item.Id)-\(tag)-v\(Self.cardVersion).png"), logo)
    }
    // Cards for logos no longer on the shelf go.
    let keep = Set(wanted.map(\.file.lastPathComponent))
    for stale in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] where !keep.contains(stale.lastPathComponent) {
      try? FileManager.default.removeItem(at: stale)
    }
    var cards: [String: URL] = [:]
    let lock = NSLock()
    let group = DispatchGroup()
    for entry in wanted {
      if FileManager.default.fileExists(atPath: entry.file.path) {
        cards[entry.id] = entry.file
        continue
      }
      group.enter()
      URLSession.shared.dataTask(with: entry.logo) { data, _, _ in
        defer { group.leave() }
        autoreleasepool {
          guard let data, let logo = UIImage(data: data), let png = renderCard(logo).pngData(), (try? png.write(to: entry.file, options: .atomic)) != nil else { return }
          lock.lock()
          cards[entry.id] = entry.file
          lock.unlock()
        }
      }.resume()
    }
    group.notify(queue: .global()) { completion(cards) }
  }

  private static func renderCard(_ logo: UIImage) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: cardSize, format: format).image { context in
      let bounds = CGRect(origin: .zero, size: cardSize)
      UIColor(red: 0x2C / 255, green: 0x2C / 255, blue: 0x2E / 255, alpha: 1).setFill()
      context.fill(bounds)
      let box = CGSize(width: bounds.width * 0.7, height: bounds.height * 0.5)
      let fit = min(box.width / max(logo.size.width, 1), box.height / max(logo.size.height, 1))
      let size = CGSize(width: logo.size.width * fit, height: logo.size.height * fit)
      // logoHalo: a white shadow tracing the logo's own alpha (0.9, 3pt on a TV card), so a dark mark reads.
      context.cgContext.saveGState()
      context.cgContext.setShadow(offset: .zero, blur: 14, color: UIColor(white: 1, alpha: 0.9).cgColor)
      logo.draw(in: CGRect(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2, width: size.width, height: size.height))
      context.cgContext.restoreGState()
      // RAISED_EDGE on TV is 3px / 1.5px on a ~550pt card: scaled to this canvas.
      let highlight = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [UIColor(white: 1, alpha: 0.22).cgColor, UIColor(white: 1, alpha: 0).cgColor] as CFArray, locations: [0, 1])!
      context.cgContext.drawLinearGradient(highlight, start: .zero, end: CGPoint(x: 0, y: 12), options: [])
      UIColor(white: 1, alpha: 0.07).setStroke()
      let hairline = UIBezierPath(rect: bounds.insetBy(dx: 1.75, dy: 1.75))
      hairline.lineWidth = 3.5
      hairline.stroke()
    }
  }

  /// The request's Items, or none on any failure: either list failing leaves the other standing.
  private static func fetchItems(_ request: URLRequest, completion: @escaping ([ShelfItemDTO]) -> Void) {
    URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        Self.log.error("fetch transport error: \(error.localizedDescription, privacy: .public)")
      }
      let status = (response as? HTTPURLResponse)?.statusCode ?? -1
      Self.log.info("fetch: status=\(status, privacy: .public) bytes=\(data?.count ?? -1, privacy: .public)")
      guard
        let data = data,
        let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let payload = try? JSONDecoder().decode(ItemsResponse.self, from: data)
      else {
        completion([])
        return
      }
      completion(payload.Items ?? [])
    }.resume()
  }

  // MARK: - Item mapping

  private static func makeShelfItem(_ item: ShelfItemDTO, base: String, apiKey: String, card: URL?) -> TVTopShelfSectionedItem {
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
    if let card {
      shelfItem.imageShape = .hdtv
      shelfItem.setImageURL(card, for: .screenScale1x)
      shelfItem.setImageURL(card, for: .screenScale2x)
    } else if item.ImageTags?["Primary"] != nil {
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
    // The params a channel card pushes (app/channels.tsx): the player opens it as a live channel.
    if item.itemType == "TvChannel" {
      link.queryItems?.append(URLQueryItem(name: "live", value: "1"))
    }
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

private struct ItemsResponse: Decodable {
  let Items: [ShelfItemDTO]?
}

private struct ShelfItemDTO: Decodable {
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

  /// LastPlayedDate to the second: the server's ISO-8601 UTC strings order as text once the fraction is cut.
  var playedKey: String { String((UserData?.LastPlayedDate ?? "").prefix(19)) }
}

private struct ResumeUserData: Decodable {
  let PlaybackPositionTicks: Double?
  let PlayedPercentage: Double?
  let LastPlayedDate: String?
}
