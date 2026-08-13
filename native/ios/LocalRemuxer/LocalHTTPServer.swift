//
//  LocalHTTPServer.swift
//  TomoTV
//
//  Loopback-only HTTP server that serves the local remux session to AVPlayer:
//  in-memory playlists and on-disk fMP4 segments. Hand-rolled on NWListener so
//  the app takes no server-library dependency; the traffic is one player on
//  127.0.0.1 requesting a playlist and a ~6s segment at a time, not a web load.
//

import Foundation
import Network

/// What the server hands back for a routed path.
enum LocalHTTPResponse {
    case data(Data, contentType: String)
    case file(URL, contentType: String)
    case notFound
}

final class LocalHTTPServer {
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "tv.tomo.localhttp")

    /// Routing runs here, NOT on GCD's shared global pool.
    ///
    /// `route` blocks: `segmentURL` waits up to 20s for a segment still being
    /// written. Dispatching those waits onto `DispatchQueue.global()` put them in
    /// the same bounded pool every other subsystem draws from, so enough
    /// simultaneous requests parked every available thread and the VIDEO init
    /// segment never got one — playback died with NSURLErrorDomain -1001 while
    /// the producer looked healthy. Adding subtitle image routes multiplies the
    /// request count per session, which is what made this worth fixing first.
    ///
    /// A private concurrent queue keeps those waits off the shared pool.
    /// Deliberately uncapped: a ceiling here can only delay a segment AVPlayer
    /// is already waiting on, and subtitle images share this path.
    private let workQueue = DispatchQueue(label: "tv.tomo.localhttp.route", attributes: .concurrent)

    /// Routes a request path (e.g. "/abc123/master.m3u8") to a response.
    /// Called on `workQueue`; may block (segment-wait logic).
    private let route: (String) -> LocalHTTPResponse

    private(set) var port: UInt16 = 0

    init(route: @escaping (String) -> LocalHTTPResponse) {
        self.route = route
    }

    /// Bind to an ephemeral port on the loopback interface. Returns the port.
    func start() throws -> UInt16 {
        let params = NWParameters.tcp
        // Loopback only: never reachable from the network.
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        params.allowLocalEndpointReuse = true

        let listener = try NWListener(using: params)
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }

        let ready = DispatchSemaphore(value: 0)
        var startError: Error?
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                ready.signal()
            case .failed(let error):
                startError = error
                ready.signal()
            default:
                break
            }
        }
        listener.start(queue: queue)

        if ready.wait(timeout: .now() + 5) == .timedOut {
            listener.cancel()
            throw NSError(domain: "LocalHTTPServer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Listener start timed out"])
        }
        if let startError {
            listener.cancel()
            throw startError
        }

        guard let boundPort = listener.port?.rawValue else {
            listener.cancel()
            throw NSError(domain: "LocalHTTPServer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Listener has no port"])
        }

        self.listener = listener
        self.port = boundPort
        return boundPort
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connection handling

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(connection, buffered: Data())
    }

    /// Accumulate until the request head is complete. Bodies are ignored: the
    /// only client is AVPlayer issuing GETs.
    private func receiveRequest(_ connection: NWConnection, buffered: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, isComplete, error in
            guard let self, error == nil, let data, !data.isEmpty else {
                connection.cancel()
                return
            }
            var buffer = buffered
            buffer.append(data)

            if let headEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[..<headEnd.lowerBound], as: UTF8.self)
                self.respond(connection, head: head)
            } else if buffer.count > 65536 || isComplete {
                connection.cancel()
            } else {
                self.receiveRequest(connection, buffered: buffer)
            }
        }
    }

    private func respond(_ connection: NWConnection, head: String) {
        let requestLine = head.components(separatedBy: "\r\n").first ?? ""
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            send(connection, status: "405 Method Not Allowed", contentType: "text/plain", body: Data())
            return
        }
        let path = String(parts[1].split(separator: "?").first ?? "")

        // Single-range support: AVPlayer occasionally probes with Range requests.
        let rangeHeader = head.components(separatedBy: "\r\n")
            .first { $0.lowercased().hasPrefix("range:") }?
            .split(separator: ":", maxSplits: 1).last.map { $0.trimmingCharacters(in: .whitespaces) }

        // Routing may block (waiting on a segment mid-write); do it off the
        // listener callback so other connections keep being accepted, and on our
        // own queue so those waits never occupy the shared global pool.
        workQueue.async { [weak self] in
            guard let self else { return }
            switch self.route(path) {
            case .data(let data, let contentType):
                self.send(connection, status: "200 OK", contentType: contentType, body: data)
            case .file(let url, let contentType):
                guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
                    self.send(connection, status: "404 Not Found", contentType: "text/plain", body: Data())
                    return
                }
                if let (slice, header) = self.slice(data, rangeHeader: rangeHeader) {
                    self.send(connection, status: "206 Partial Content", contentType: contentType, body: slice, extraHeaders: header)
                } else {
                    self.send(connection, status: "200 OK", contentType: contentType, body: data)
                }
            case .notFound:
                self.send(connection, status: "404 Not Found", contentType: "text/plain", body: Data())
            }
        }
    }

    /// Apply a single "bytes=a-b" range. Returns nil to serve the whole body.
    private func slice(_ data: Data, rangeHeader: String?) -> (Data, String)? {
        guard let rangeHeader, rangeHeader.hasPrefix("bytes=") else { return nil }
        let spec = rangeHeader.dropFirst("bytes=".count)
        // Only the simple forms "a-b" and "a-" are supported; anything else
        // falls back to a full 200 response, which is always valid.
        let bounds = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard bounds.count == 2, let start = Int(bounds[0]), start >= 0, start < data.count else { return nil }
        let end = Int(bounds[1]).map { min($0, data.count - 1) } ?? (data.count - 1)
        guard end >= start else { return nil }
        let slice = data.subdata(in: start..<(end + 1))
        return (slice, "Content-Range: bytes \(start)-\(end)/\(data.count)\r\n")
    }

    private func send(_ connection: NWConnection, status: String, contentType: String, body: Data, extraHeaders: String = "") {
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: \(contentType)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Accept-Ranges: bytes\r\n"
        head += "Cache-Control: no-cache\r\n"
        head += extraHeaders
        head += "Connection: close\r\n\r\n"

        var response = Data(head.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
