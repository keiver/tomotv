//
//  SourceLoader.swift
//  TomoTV
//
//  Streams a source (http(s) or file URL, gzip or plain) through Gunzip into a sink as the bytes
//  arrive, so download, inflate and parse overlap and the whole file is never held.
//

import Foundation

/// Bytes in any chunking; `finish` runs once after the last chunk.
protocol StreamSink: AnyObject {
    func push(_ bytes: UnsafeRawBufferPointer)
    func finish()
}

struct LoadStats: Equatable {
    var firstByteMs = 0
    var totalMs = 0
    /// Time spent inflating and parsing, excluding waits on the network.
    var workMs = 0
    var networkBytes = 0
    var inflatedBytes = 0
    /// Process footprint when the load began, its highest sample while parsing, and at the end.
    var footprintBeforeBytes = 0
    var peakFootprintBytes = 0
    var footprintAfterBytes = 0
}

enum SourceLoadError: Error {
    case http(Int)
    case decode(Error)
}

final class SourceLoader: NSObject, URLSessionDataDelegate {
    private let sink: StreamSink
    private let gunzip = Gunzip()
    /// Released after the one call: its captures (often the owning wrapper) must not outlive the load.
    private var completion: ((Result<LoadStats, Error>) -> Void)?
    private var stats = LoadStats()
    private let started = DispatchTime.now()
    private var workNanos: UInt64 = 0
    private var failure: Error?
    private var session: URLSession?

    /// Starts the load; `completion` runs once on the loader's own queue. Keep the loader to cancel it.
    static func load(
        url: URL, headers: [String: String], sink: StreamSink, configuration: URLSessionConfiguration,
        completion: @escaping (Result<LoadStats, Error>) -> Void
    ) -> SourceLoader {
        let loader = SourceLoader(sink: sink, completion: completion)
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        // The caller's configuration stays untouched.
        let own = configuration.copy() as! URLSessionConfiguration
        own.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: own, delegate: loader, delegateQueue: queue)
        loader.session = session
        var request = URLRequest(url: url)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        session.dataTask(with: request).resume()
        return loader
    }

    /// Feeds bytes already in memory, 64 KB at a time, on the caller's thread.
    static func parse(data: Data, sink: StreamSink) throws -> LoadStats {
        var result: Result<LoadStats, Error>?
        let loader = SourceLoader(sink: sink) { result = $0 }
        data.withUnsafeBytes { all in
            var offset = 0
            while offset < all.count, loader.failure == nil {
                let end = min(offset + 65536, all.count)
                loader.feed(UnsafeRawBufferPointer(rebasing: all[offset ..< end]))
                offset = end
            }
        }
        loader.stats.networkBytes = data.count
        loader.complete(error: nil)
        return try result!.get()
    }

    private init(sink: StreamSink, completion: @escaping (Result<LoadStats, Error>) -> Void) {
        self.sink = sink
        self.completion = completion
        super.init()
        stats.footprintBeforeBytes = MemoryFootprint.bytes()
        stats.peakFootprintBytes = stats.footprintBeforeBytes
    }

    func cancel() {
        session?.invalidateAndCancel()
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
            failure = SourceLoadError.http(http.statusCode)
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_: URLSession, dataTask task: URLSessionDataTask, didReceive data: Data) {
        guard failure == nil else { return }
        if stats.networkBytes == 0 { stats.firstByteMs = elapsedMs() }
        stats.networkBytes += data.count
        data.withUnsafeBytes { feed($0) }
        // A decode failure ends the download instead of draining the rest of the body.
        if failure != nil { DispatchQueue.global().async { task.cancel() } }
    }

    func urlSession(_ session: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        session.finishTasksAndInvalidate()
        complete(error: error)
    }

    // MARK: Pipeline

    private func feed(_ bytes: UnsafeRawBufferPointer) {
        guard failure == nil else { return }
        let begin = DispatchTime.now().uptimeNanoseconds
        do {
            try gunzip.push(bytes) { sink.push($0) }
        } catch {
            failure = SourceLoadError.decode(error)
        }
        workNanos += DispatchTime.now().uptimeNanoseconds - begin
        stats.peakFootprintBytes = max(stats.peakFootprintBytes, MemoryFootprint.bytes())
    }

    private func complete(error: Error?) {
        let begin = DispatchTime.now().uptimeNanoseconds
        if failure == nil, error == nil {
            do {
                try gunzip.finish { sink.push($0) }
                sink.finish()
            } catch {
                failure = SourceLoadError.decode(error)
            }
        }
        workNanos += DispatchTime.now().uptimeNanoseconds - begin
        stats.totalMs = elapsedMs()
        stats.workMs = Int(workNanos / 1_000_000)
        stats.inflatedBytes = gunzip.inflatedBytes
        stats.footprintAfterBytes = MemoryFootprint.bytes()
        stats.peakFootprintBytes = max(stats.peakFootprintBytes, stats.footprintAfterBytes)
        guard let done = completion else { return }
        completion = nil
        // The decode failure outranks the cancellation it caused.
        if let failure = failure ?? error {
            done(.failure(failure))
        } else {
            done(.success(stats))
        }
    }

    private func elapsedMs() -> Int {
        Int((DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000)
    }
}
