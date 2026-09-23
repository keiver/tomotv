//
//  LiveStreamReader.swift
//  TomoTV
//
//  A raw live stream's bytes through URLSession, handed to FFmpeg as custom I/O: a grab's demuxer
//  never opens the network, so its TLS never runs beside a playing session's.
//

import Foundation

final class LiveStreamReader: NSObject, URLSessionDataDelegate {
    /// A grab stops at its first keyframe; a stream that has given none by here is not giving one.
    static let capBytes: Int64 = 8 * 1024 * 1024

    private let condition = NSCondition()
    private var pending = Data()
    private var ended = false
    private var task: URLSessionDataTask?
    /// Body bytes received so far.
    private(set) var bytes: Int64 = 0

    init(url: URL, headers: [String: String], timeout: TimeInterval) {
        super.init()
        var request = URLRequest(url: url, timeoutInterval: timeout)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let task = URLSession.shared.dataTask(with: request)
        task.delegate = self
        self.task = task
        task.resume()
    }

    func cancel() {
        finish()
        task?.cancel()
    }

    /// Blocks until bytes arrive; 0 once the stream has ended or been cancelled and nothing is left.
    func read(into buffer: UnsafeMutablePointer<UInt8>, max: Int) -> Int {
        condition.lock()
        defer { condition.unlock() }
        while pending.isEmpty && !ended { condition.wait() }
        let count = min(max, pending.count)
        guard count > 0 else { return 0 }
        pending.copyBytes(to: buffer, count: count)
        pending.removeFirst(count)
        return count
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let ok = (200 ..< 300).contains((response as? HTTPURLResponse)?.statusCode ?? 0)
        if !ok { finish() }
        completionHandler(ok ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        condition.lock()
        pending.append(chunk)
        bytes += Int64(chunk.count)
        let full = bytes >= Self.capBytes
        condition.broadcast()
        condition.unlock()
        if full { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish()
    }

    private func finish() {
        condition.lock()
        ended = true
        condition.broadcast()
        condition.unlock()
    }
}
