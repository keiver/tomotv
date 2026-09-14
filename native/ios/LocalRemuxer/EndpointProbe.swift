//
//  EndpointProbe.swift
//  TomoTV
//
//  Reachability from the answers an endpoint gives: an HTTP status, a refused connection, a host
//  that does not resolve. Silence is never read as a verdict; the caller's own wait covers it.
//

import Foundation

enum EndpointProbe {
    /// What one request learned.
    enum Answer {
        /// The endpoint answered; `body` is kept only when asked for.
        case status(Int, finalURL: URL?, body: Data?)
        /// No connection at all: refused, or the host does not resolve.
        case refused(String)
        /// Nothing definite: a timeout, or a transport error that says nothing about the endpoint.
        case unknown
    }

    fileprivate static let refusalCodes: Set<URLError.Code> = [.cannotConnectToHost, .cannotFindHost, .dnsLookupFailed]

    /// A 4xx says the endpoint will not serve this; 408 and 429 ask to come back later.
    static func isRefusalStatus(_ code: Int) -> Bool {
        (400..<500).contains(code) && code != 408 && code != 429
    }

    /// One blocking request. Without `keepBody` the body is dropped at its first byte, which is when
    /// URLSession hands the response over (measured: never on headers alone).
    static func request(_ url: URL, headers: [String: String] = [:], range: String? = nil, keepBody: Bool, timeout: TimeInterval) -> Answer {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        if let range { request.setValue(range, forHTTPHeaderField: "Range") }
        let exchange = Exchange(keepBody: keepBody)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: configuration, delegate: exchange, delegateQueue: nil)
        session.dataTask(with: request).resume()
        exchange.done.wait()
        session.finishTasksAndInvalidate()
        return exchange.answer
    }

    /// Why a live HLS origin cannot play: every path to a segment was refused. nil when any path
    /// answered, or when nothing definite came back.
    /// `cancelled` is asked before every request, so a stopped session asks the origin nothing more.
    static func hlsOriginRefusal(_ urlString: String, headers: [String: String], timeout: TimeInterval, cancelled: @escaping () -> Bool = { false }) -> String? {
        guard let url = URL(string: urlString), !cancelled() else { return nil }
        switch request(url, headers: headers, keepBody: true, timeout: timeout) {
        case .refused(let why):
            return "origin unreachable (\(why))"
        case .unknown:
            return nil
        case .status(let code, let finalURL, let body):
            if isRefusalStatus(code) { return "origin refused the playlist (HTTP \(code))" }
            guard (200..<300).contains(code), let text = body.flatMap({ String(data: $0, encoding: .utf8) }), text.contains("#EXTM3U") else { return nil }
            let base = finalURL ?? url
            let variants = variantURLs(text, base: base)
            if variants.isEmpty {
                if case .refused(let why) = newestSegmentPath(text, base: base, headers: headers, timeout: timeout, cancelled: cancelled) { return "origin refused \(why)" }
                return nil
            }
            var paths = [Path](repeating: .unknown, count: variants.count)
            let lock = NSLock()
            DispatchQueue.concurrentPerform(iterations: variants.count) { index in
                let path = variantPath(variants[index], headers: headers, timeout: timeout, cancelled: cancelled)
                lock.lock()
                paths[index] = path
                lock.unlock()
            }
            let refusals = paths.compactMap { path -> String? in
                if case .refused(let why) = path { return why }
                return nil
            }
            return refusals.count == paths.count ? "origin refused every variant (\(refusals[0]))" : nil
        }
    }

    // MARK: - HLS paths

    private enum Path {
        case alive
        case refused(String)
        case unknown
    }

    private static func variantPath(_ url: URL, headers: [String: String], timeout: TimeInterval, cancelled: () -> Bool) -> Path {
        guard !cancelled() else { return .unknown }
        switch request(url, headers: headers, keepBody: true, timeout: timeout) {
        case .refused(let why):
            return .refused(why)
        case .unknown:
            return .unknown
        case .status(let code, let finalURL, let body):
            if isRefusalStatus(code) { return .refused("playlist HTTP \(code)") }
            guard (200..<300).contains(code), let text = body.flatMap({ String(data: $0, encoding: .utf8) }) else { return .unknown }
            return newestSegmentPath(text, base: finalURL ?? url, headers: headers, timeout: timeout, cancelled: cancelled)
        }
    }

    /// A live playlist that lists no segment yet says nothing either way.
    private static func newestSegmentPath(_ playlist: String, base: URL, headers: [String: String], timeout: TimeInterval, cancelled: () -> Bool) -> Path {
        guard !cancelled(),
              let uri = playlist.split(whereSeparator: \.isNewline).map({ $0.trimmingCharacters(in: .whitespaces) }).last(where: { !$0.isEmpty && !$0.hasPrefix("#") }),
              let segment = URL(string: uri, relativeTo: base)?.absoluteURL else { return .unknown }
        switch request(segment, headers: headers, range: "bytes=0-0", keepBody: false, timeout: timeout) {
        case .refused(let why):
            return .refused(why)
        case .unknown:
            return .unknown
        case .status(let code, _, _):
            if isRefusalStatus(code) { return .refused("segment HTTP \(code)") }
            return (200..<300).contains(code) ? .alive : .unknown
        }
    }

    /// Every variant a multivariant playlist declares, absolute; empty for a media playlist.
    static func variantURLs(_ playlist: String, base: URL) -> [URL] {
        let lines = playlist.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        var urls: [URL] = []
        for (index, line) in lines.enumerated() where line.hasPrefix("#EXT-X-STREAM-INF:") {
            guard let uri = lines[(index + 1)...].first(where: { !$0.isEmpty && !$0.hasPrefix("#") }),
                  let url = URL(string: uri, relativeTo: base)?.absoluteURL else { continue }
            urls.append(url)
        }
        return urls
    }
}

/// One request's delegate: records the response, keeps or drops the body, classifies the failure.
private final class Exchange: NSObject, URLSessionDataDelegate {
    let keepBody: Bool
    let done = DispatchSemaphore(value: 0)
    private(set) var answer: EndpointProbe.Answer = .unknown
    private var response: HTTPURLResponse?
    private var body = Data()

    init(keepBody: Bool) {
        self.keepBody = keepBody
    }

    func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        self.response = response as? HTTPURLResponse
        completionHandler(keepBody ? .allow : .cancel)
    }

    func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive data: Data) {
        body.append(data)
    }

    func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        if let response {
            answer = .status(response.statusCode, finalURL: response.url, body: keepBody ? body : nil)
        } else if let urlError = error as? URLError, EndpointProbe.refusalCodes.contains(urlError.code) {
            answer = .refused(urlError.localizedDescription)
        }
        done.signal()
    }
}
