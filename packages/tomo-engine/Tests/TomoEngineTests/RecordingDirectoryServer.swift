import Foundation
import Network

/// A loopback HTTP server over a directory that records every request's path and User-Agent:
/// the origin a live test reads, and the evidence of which of its files the engine asked for.
final class RecordingDirectoryServer {
    struct Request {
        let path: String
        let userAgent: String?
    }

    private let listener: NWListener
    private let root: URL
    private let queue = DispatchQueue(label: "recording-directory-server")
    private let lock = NSLock()
    private var recorded: [Request] = []

    init(root: URL) throws {
        self.root = root
        listener = try NWListener(using: .tcp, on: .any)
        let ready = DispatchSemaphore(value: 0)
        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.stateUpdateHandler = { state in if case .ready = state { ready.signal() } }
        listener.start(queue: queue)
        ready.wait()
    }

    var port: UInt16 { listener.port?.rawValue ?? 0 }
    var base: String { "http://127.0.0.1:\(port)" }

    var requests: [Request] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func stop() { listener.cancel() }

    /// While silent, every request is taken and never answered: a feed that died without closing.
    private var silent = false
    private var held: [NWConnection] = []
    func goSilent() {
        lock.lock()
        silent = true
        lock.unlock()
    }

    func speakAgain() {
        lock.lock()
        silent = false
        let hanging = held
        held = []
        lock.unlock()
        hanging.forEach { $0.cancel() }
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, error in
            guard let self, error == nil, let data, let head = String(data: data, encoding: .utf8) else { connection.cancel(); return }
            self.lock.lock()
            let hold = self.silent
            if hold { self.held.append(connection) }
            self.lock.unlock()
            if hold { return }
            let lines = head.components(separatedBy: "\r\n")
            let path = lines.first?.split(separator: " ").dropFirst().first.map { String($0.split(separator: "?").first ?? "") } ?? ""
            let agent = lines.first { $0.lowercased().hasPrefix("user-agent:") }.map { String($0.dropFirst("user-agent:".count)).trimmingCharacters(in: .whitespaces) }
            self.lock.lock()
            self.recorded.append(Request(path: path, userAgent: agent))
            self.lock.unlock()
            let file = self.root.appendingPathComponent(String(path.drop { $0 == "/" }))
            let body = try? Data(contentsOf: file)
            let status = body == nil ? "404 Not Found" : "200 OK"
            let type = path.hasSuffix(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t"
            let response = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body?.count ?? 0)\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(response.utf8) + (body ?? Data()), completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}
