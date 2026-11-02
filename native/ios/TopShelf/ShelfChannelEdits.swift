import Foundation

/// The channels the viewer hid or renamed, as the app writes them for the shelf
/// (services/topShelfChannelEdits.ts): each entry names a channel by id, number and name.
struct ShelfChannelEdits: Decodable {
  struct Entry: Decodable {
    let id: String?
    let number: String?
    let name: String
    let displayName: String?
  }

  let hidden: [Entry]
  let renames: [Entry]

  static let empty = ShelfChannelEdits(hidden: [], renames: [])

  /// The file's edits, or none when the file is missing or unreadable.
  static func load(from url: URL) -> ShelfChannelEdits {
    guard let data = try? Data(contentsOf: url), let edits = try? JSONDecoder().decode(ShelfChannelEdits.self, from: data) else { return .empty }
    return edits
  }

  /// An entry names a channel by its id, else by number and name the way the app keys its lists:
  /// an entry without a number matches only a channel without one.
  private static func matches(_ entry: Entry, id: String, number: String?, name: String?) -> Bool {
    if let entryId = entry.id, entryId == id { return true }
    guard let name, entry.name == name else { return false }
    let trimmed = number?.trimmingCharacters(in: .whitespaces) ?? ""
    return (entry.number ?? "") == trimmed
  }

  func isHidden(id: String, number: String?, name: String?) -> Bool {
    hidden.contains { Self.matches($0, id: id, number: number, name: name) }
  }

  func displayName(id: String, number: String?, name: String?) -> String? {
    renames.first { Self.matches($0, id: id, number: number, name: name) }?.displayName
  }
}
