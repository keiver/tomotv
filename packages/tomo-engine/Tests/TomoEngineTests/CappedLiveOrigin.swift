import Foundation
import Network

/// A loopback live TS origin that admits `maxReaders` at a time, answers the rest 429 and loops a TS file to
/// each reader; `dropReaders` closes them and answers 503 for `seconds` to every request but a `?grab` one.
final class CappedLiveOrigin {
    private let listener: NWListener
    private let body: Data
    private let maxReaders: Int
    private let queue = DispatchQueue(label: "capped-live-origin")
    private let lock = NSLock()
    private var readers: [ObjectIdentifier: NWConnection] = [:]
    private var refusingUntil = Date.distantPast
    /// Dropped readers it still counts against `maxReaders` until then, and the status it refuses with meanwhile.
    private var lingering: (count: Int, until: Date, status: String) = (0, .distantPast, "429 Too Many Requests")
    private(set) var peak = 0

    init(fixture: URL, maxReaders: Int = 1) throws {
        body = try Data(contentsOf: fixture)
        self.maxReaders = maxReaders
        listener = try NWListener(using: .tcp, on: .any)
        let ready = DispatchSemaphore(value: 0)
        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.stateUpdateHandler = { state in if case .ready = state { ready.signal() } }
        listener.start(queue: queue)
        ready.wait()
    }

    var base: String { "http://127.0.0.1:\(listener.port?.rawValue ?? 0)" }

    var active: Int {
        lock.lock()
        defer { lock.unlock() }
        return readers.count
    }

    func stop() {
        listener.cancel()
        lock.lock()
        let open = Array(readers.values)
        readers = [:]
        lock.unlock()
        open.forEach { $0.cancel() }
    }

    func dropReaders(refusingFor seconds: TimeInterval) {
        lock.lock()
        let open = Array(readers.values)
        readers = [:]
        refusingUntil = Date().addingTimeInterval(seconds)
        lock.unlock()
        open.forEach { $0.cancel() }
    }

    /// Closes every reader and counts them for `seconds` more, as an account that frees a slot late.
    func dropReaders(countingFor seconds: TimeInterval, answering status: String = "429 Too Many Requests") {
        lock.lock()
        let open = Array(readers.values)
        readers = [:]
        lingering = (open.count, Date().addingTimeInterval(seconds), status)
        lock.unlock()
        open.forEach { $0.cancel() }
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, error in
            guard let self, error == nil, let data, let head = String(data: data, encoding: .utf8) else { connection.cancel(); return }
            let target = head.components(separatedBy: "\r\n").first?.split(separator: " ").dropFirst().first.map(String.init) ?? ""
            self.lock.lock()
            let refusing = Date() < self.refusingUntil && !target.contains("grab")
            let counted = Date() < self.lingering.until ? self.lingering.count : 0
            let full = self.readers.count + counted >= self.maxReaders
            let fullStatus = self.readers.count < self.maxReaders && counted > 0 ? self.lingering.status : "429 Too Many Requests"
            if !refusing, !full {
                self.readers[ObjectIdentifier(connection)] = connection
                self.peak = max(self.peak, self.readers.count)
            }
            self.lock.unlock()
            if refusing || full {
                let status = refusing ? "503 Service Unavailable" : fullStatus
                connection.send(content: Data("HTTP/1.1 \(status)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8),
                                completion: .contentProcessed { _ in connection.cancel() })
                return
            }
            connection.stateUpdateHandler = { [weak self] state in
                switch state {
                case .cancelled, .failed:
                    self?.lock.lock()
                    self?.readers.removeValue(forKey: ObjectIdentifier(connection))
                    self?.lock.unlock()
                default: break
                }
            }
            connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in })
            self.feed(connection, from: 0)
        }
    }

    /// 188-byte packets, 64 KB every 50 ms, from the top of the file again at its end.
    private func feed(_ connection: NWConnection, from offset: Int) {
        lock.lock()
        let reading = readers[ObjectIdentifier(connection)] != nil
        lock.unlock()
        guard reading else { return }
        let end = min(offset + 65_424, body.count)
        connection.send(content: body.subdata(in: offset..<end), completion: .contentProcessed { [weak self] error in
            guard error == nil else { connection.cancel(); return }
            self?.queue.asyncAfter(deadline: .now() + 0.05) { self?.feed(connection, from: end == self?.body.count ? 0 : end) }
        })
    }
}
