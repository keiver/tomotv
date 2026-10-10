//
//  ParallelRangeReader.swift
//  TomoTV
//
//  One HTTP file read through several ranged connections at once, presented to
//  FFmpeg as a plain blocking read/seek pair. Aggregates bandwidth where a link
//  caps each connection; a server that ignores Range never gets a reader.
//

import Foundation

/// Fetches fixed-size chunks ahead of the read cursor on a few connections and
/// serves them strictly in order, streaming each chunk's bytes as they arrive so
/// a slow link still trickles into the demuxer the way one connection does.
/// Gains taper past a handful of connections and over-reading wastes a seeky
/// session's bytes, so the window stays small.
final class ParallelRangeReader: NSObject {
    static let chunkBytes = 2 << 20
    static let connections = 3
    /// Chunks held or in flight ahead of the cursor; bounds memory and seek waste.
    static let windowChunks = 4
    /// A chunk whose fetch fails retries this many times before the reader fails.
    static let chunkRetries = 2
    private static let readTimeout: TimeInterval = 20

    let size: Int64
    private let url: URL
    private let headers: [String: String]
    private var session: URLSession!

    private let lock = NSLock()
    private let ready = NSCondition()
    /// Arriving and complete chunk bodies by index, dropped as the cursor passes them.
    private var bodies: [Int64: Data] = [:]
    private var complete: Set<Int64> = []
    private var tasks: [Int64: URLSessionDataTask] = [:]
    private var taskChunk: [Int: Int64] = [:]
    private var retriesLeft: [Int64: Int] = [:]
    private var cursor: Int64 = 0
    private var failed = false
    private var closed = false
    /// Slow start: one chunk in flight until reads drain one, so a slow link's
    /// opening probe is never starved by prefetch it does not need yet.
    private var window = 1

    /// Answers at the response headers and cancels the body: a range-ignoring
    /// server would otherwise stream the whole file into the probe.
    private final class ProbeDelegate: NSObject, URLSessionDataDelegate {
        let waiter = DispatchSemaphore(value: 0)
        var total: Int64 = -1
        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            if let http = response as? HTTPURLResponse, http.statusCode == 206,
               let range = http.value(forHTTPHeaderField: "Content-Range"),
               let declared = Int64(range.split(separator: "/").last ?? ""), declared > 0 {
                total = declared
            }
            completionHandler(.cancel)
            waiter.signal()
        }
        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            waiter.signal()
        }
    }

    /// Opens a reader when the server answers a ranged probe with 206 and a total;
    /// nil sends the caller down the ordinary single-connection path.
    static func open(url: URL, headers: [String: String]) -> ParallelRangeReader? {
        var request = URLRequest(url: url, timeoutInterval: 15)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        let delegate = ProbeDelegate()
        let probe = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        probe.dataTask(with: request).resume()
        _ = delegate.waiter.wait(timeout: .now() + 15)
        probe.invalidateAndCancel()
        guard delegate.total > Int64(chunkBytes) else { return nil }
        NSLog("[ParallelRangeReader] open %lld bytes, %d connections, %d MB chunks", delegate.total, connections, chunkBytes >> 20)
        return ParallelRangeReader(url: url, headers: headers, size: delegate.total)
    }

    private init(url: URL, headers: [String: String], size: Int64) {
        self.url = url
        self.headers = headers
        self.size = size
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpMaximumConnectionsPerHost = Self.connections
        configuration.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        schedule()
    }

    private func chunkIndex(_ offset: Int64) -> Int64 { offset / Int64(Self.chunkBytes) }
    private var lastChunk: Int64 { (size - 1) / Int64(Self.chunkBytes) }
    private func span(of index: Int64) -> (start: Int64, end: Int64) {
        let start = index * Int64(Self.chunkBytes)
        return (start, min(start + Int64(Self.chunkBytes) - 1, size - 1))
    }

    /// Starts fetches so the window ahead of the cursor stays covered.
    private func schedule() {
        lock.lock()
        guard !failed, !closed else {
            lock.unlock()
            return
        }
        let first = chunkIndex(cursor)
        var started: [URLSessionDataTask] = []
        for index in first ... min(first + Int64(window) - 1, lastChunk) {
            guard !complete.contains(index), tasks[index] == nil, tasks.count < Self.connections else { continue }
            let (start, end) = span(of: index)
            var request = URLRequest(url: url)
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
            request.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
            let task = session.dataTask(with: request)
            tasks[index] = task
            taskChunk[task.taskIdentifier] = index
            bodies[index] = Data()
            started.append(task)
        }
        lock.unlock()
        for task in started { task.resume() }
    }

    /// Blocking in-order read; serves whatever the head chunk holds so far.
    /// -1 on failure or timeout, 0 at end of file.
    func read(into buffer: UnsafeMutableRawPointer, count: Int) -> Int {
        if count <= 0 { return 0 }
        schedule()
        let deadline = Date().addingTimeInterval(Self.readTimeout)
        while true {
            lock.lock()
            if failed || closed {
                lock.unlock()
                return -1
            }
            if cursor >= size {
                lock.unlock()
                return 0
            }
            let index = chunkIndex(cursor)
            let within = Int(cursor - index * Int64(Self.chunkBytes))
            if let body = bodies[index], body.count > within {
                let served = min(count, body.count - within)
                body.withUnsafeBytes { raw in
                    buffer.copyMemory(from: raw.baseAddress!.advanced(by: within), byteCount: served)
                }
                cursor += Int64(served)
                if complete.contains(index), within + served == body.count {
                    bodies[index] = nil
                    complete.remove(index)
                    window = min(window + 1, Self.windowChunks)
                }
                lock.unlock()
                schedule()
                return served
            }
            lock.unlock()
            if Date() >= deadline {
                NSLog("[ParallelRangeReader] read timed out waiting for chunk %lld", chunkIndex(cursor))
                return -1
            }
            ready.lock()
            ready.wait(until: Date().addingTimeInterval(0.2))
            ready.unlock()
        }
    }

    /// Repositions the cursor; fetches outside the new window are cancelled so a
    /// paced link is never spent on bytes a seek abandoned.
    func seek(to offset: Int64) -> Int64 {
        let clamped = max(0, min(offset, size))
        lock.lock()
        cursor = clamped
        window = 1
        let keepFrom = chunkIndex(clamped)
        let keepTo = keepFrom + Int64(Self.windowChunks) - 1
        var cancelling: [URLSessionDataTask] = []
        for (index, task) in tasks where index < keepFrom || index > keepTo {
            cancelling.append(task)
            taskChunk[task.taskIdentifier] = nil
            tasks[index] = nil
        }
        bodies = bodies.filter { ($0.key >= keepFrom && $0.key <= keepTo) || tasks[$0.key] != nil }
        complete = complete.filter { $0 >= keepFrom && $0 <= keepTo }
        lock.unlock()
        for task in cancelling { task.cancel() }
        schedule()
        return clamped
    }

    func close() {
        lock.lock()
        closed = true
        bodies = [:]
        tasks = [:]
        taskChunk = [:]
        lock.unlock()
        session.invalidateAndCancel()
        ready.lock()
        ready.signal()
        ready.unlock()
    }

    deinit { close() }
}

extension ParallelRangeReader: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        if let index = taskChunk[dataTask.taskIdentifier], !closed { bodies[index]?.append(data) }
        lock.unlock()
        ready.lock()
        ready.signal()
        ready.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard let index = taskChunk[task.taskIdentifier] else {
            lock.unlock()
            return
        }
        taskChunk[task.taskIdentifier] = nil
        tasks[index] = nil
        if closed {
            lock.unlock()
            return
        }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let (start, end) = span(of: index)
        let whole = Int64(bodies[index]?.count ?? 0) == end - start + 1
        if error == nil, status == 206, whole {
            complete.insert(index)
            lock.unlock()
        } else {
            bodies[index] = nil
            let left = retriesLeft[index, default: Self.chunkRetries]
            if left > 0 {
                retriesLeft[index] = left - 1
                lock.unlock()
                NSLog("[ParallelRangeReader] chunk %lld failed (HTTP %d), retrying", index, status)
            } else {
                failed = true
                lock.unlock()
                NSLog("[ParallelRangeReader] chunk %lld failed for good (HTTP %d)", index, status)
            }
        }
        ready.lock()
        ready.signal()
        ready.unlock()
        schedule()
    }
}
