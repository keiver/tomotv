import Foundation

enum DrillEnvironment {
    enum ConfigurationError: Error, Equatable {
        case missingVariable(String)
    }

    static func resolve(_ value: Any, environment: [String: String]) throws -> Any {
        if let entries = value as? [String: Any] {
            return try entries.mapValues { try resolve($0, environment: environment) }
        }
        if let entries = value as? [Any] {
            return try entries.map { try resolve($0, environment: environment) }
        }
        guard var text = value as? String else { return value }
        for name in ["JELLYFIN_URL", "JELLYFIN_API_KEY"] where text.contains("${\(name)}") {
            guard let supplied = environment[name], !supplied.isEmpty else { throw ConfigurationError.missingVariable(name) }
            let replacement: String
            if name == "JELLYFIN_API_KEY" {
                let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#%"))
                replacement = supplied.addingPercentEncoding(withAllowedCharacters: allowed) ?? supplied
            } else {
                replacement = supplied.hasSuffix("/") ? String(supplied.dropLast()) : supplied
            }
            text = text.replacingOccurrences(of: "${\(name)}", with: replacement)
        }
        return text
    }

    static func redact(_ value: Any, environment: [String: String]) -> Any {
        if let entries = value as? [String: Any] { return entries.mapValues { redact($0, environment: environment) } }
        if let entries = value as? [Any] { return entries.map { redact($0, environment: environment) } }
        guard var text = value as? String, let secret = environment["JELLYFIN_API_KEY"], !secret.isEmpty else { return value }
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#%"))
        for representation in [secret.addingPercentEncoding(withAllowedCharacters: allowed) ?? secret, secret] {
            text = text.replacingOccurrences(of: representation, with: "[REDACTED]")
        }
        return text
    }
}
