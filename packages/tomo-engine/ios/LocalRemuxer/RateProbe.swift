import Foundation

/// Times a URL's body through a RateMeter for its whole budget from the first byte: no reading ends early on a
/// flat stretch, which a burst allowance also shows. `beside` counts what other transfers carried meanwhile.
/// Several connections each read their own range, as the pipeline does, and the meter adds them up.
final class RateProbe: NSObject, URLSessionDataDelegate {
    struct Outcome {
        let reading: RateMeter.Reading?
        let failure: LinkProbeFailure?
        /// Each settled 100ms sample's rate, for reading a run back.
        var samples: [Double] = []

        /// The reading Settings stands behind: none from a refused request, nor from under a window of delivery, which times a burst.
        var linkReading: RateMeter.Reading? {
            guard failure == nil || failure == .transient(0), let reading, reading.bps > 0, reading.kind != .short else { return nil }
            return reading
        }
    }

    /// Bytes between the ranges the connections start at, inside any file worth a ladder. A fast connection
    /// reads into the next one's range before the budget ends; the wire carries those bytes all the same.
    static let connectionStride: Int64 = 8 << 20

    private let request: URLRequest
    private let budget: Double
    private let firstByteWithin: Double
    /// Asks again when a body ends first: a fixed-size test body can be shorter than the budget.
    private let repeats: Bool
    private let connections: Int
    private let beside: () -> Int64
    private let clock: () -> Double
    private let done = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var meter = RateMeter()
    private var firstByteAt: Double?
    private var besideSeen: Int64 = 0
    private var finished = false
    private var cancelled = false
    private var failure: LinkProbeFailure?
    /// Each task's transfer, as the meter counts it; a task that has ended is dropped.
    private var transfers: [Int: Int] = [:]
    private var open = 0

    init(request: URLRequest, budget: Double, firstByteWithin: Double, repeats: Bool = false, connections: Int = 1,
         beside: @escaping () -> Int64 = { 0 }, clock: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime }) {
        self.request = request
        self.budget = budget
        self.firstByteWithin = firstByteWithin
        self.repeats = repeats
        self.connections = max(1, connections)
        self.beside = beside
        self.clock = clock
    }

    /// Blocks until the probe has its answer. A nil reading means nothing flowed.
    func run() -> Outcome {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpMaximumConnectionsPerHost = connections
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        open = connections
        for transfer in 0 ..< connections { start(transfer, on: session) }
        if done.wait(timeout: .now() + firstByteWithin) == .timedOut {
            lock.lock()
            let flowing = firstByteAt.map { budget - (clock() - $0) }
            lock.unlock()
            // A stalled body sends no chunk to stop on, so the budget is also a deadline.
            if let left = flowing { _ = done.wait(timeout: .now() + max(0, left) + 0.5) }
        }
        lock.lock()
        // No chunk or ending stopped the read: it ran into its deadline on a body gone quiet.
        if !finished, let first = firstByteAt { meter.close(at: min(clock(), first + budget)) }
        finished = true
        let outcome = Outcome(reading: firstByteAt == nil || cancelled ? nil : meter.reading(), failure: failure, samples: meter.samples())
        lock.unlock()
        session.invalidateAndCancel()
        return outcome
    }

    /// Ends the read now with no reading: whatever took the link shared it with the probe.
    func cancel() {
        lock.lock()
        cancelled = true
        finished = true
        lock.unlock()
        done.signal()
    }

    /// The first connection reads the request as given; each further one starts its range a stride on.
    private func request(for transfer: Int) -> URLRequest {
        guard transfer > 0 else { return request }
        var ranged = request
        ranged.setValue("bytes=\(Int64(transfer) * Self.connectionStride)-", forHTTPHeaderField: "Range")
        return ranged
    }

    private func start(_ transfer: Int, on session: URLSession) {
        let task = session.dataTask(with: request(for: transfer))
        lock.lock()
        transfers[task.taskIdentifier] = transfer
        lock.unlock()
        task.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        guard !(200..<300).contains(status) else { return completionHandler(.allow) }
        lock.lock()
        // A range past a small file's end refuses one extra connection, not the probe.
        if let transfer = transfers[dataTask.taskIdentifier], transfer > 0 {
            transfers[dataTask.taskIdentifier] = nil
            open -= 1
            meter.ended(transfer)
            let last = open <= 0 && !finished
            if last { finished = true }
            lock.unlock()
            completionHandler(.cancel)
            if last { done.signal() }
            return
        }
        let first = !finished
        if first { failure = LinkProbeFailure.classify(status: status) }
        finished = true
        lock.unlock()
        completionHandler(.cancel)
        if first { done.signal() }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let carried = beside()
        lock.lock()
        guard !finished, let transfer = transfers[dataTask.taskIdentifier] else { return lock.unlock() }
        let now = clock()
        if firstByteAt == nil {
            firstByteAt = now
            besideSeen = carried
        }
        meter.received(transfer, bytes: data.count + Int(max(0, carried - besideSeen)), at: now)
        besideSeen = carried
        let stop = now - (firstByteAt ?? now) >= budget
        if stop { finished = true }
        lock.unlock()
        if stop {
            dataTask.cancel()
            done.signal()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard !finished, let transfer = transfers.removeValue(forKey: task.taskIdentifier) else { return lock.unlock() }
        // A repeat keeps the flow open: the round trip and the server's fill before the next body are the link too.
        let again = error == nil && repeats && firstByteAt != nil
        if again {
            lock.unlock()
            return start(transfer, on: session)
        }
        meter.ended(transfer)
        open -= 1
        if error != nil { failure = .transient(0) }
        let last = open <= 0
        if last { finished = true }
        lock.unlock()
        if last { done.signal() }
    }
}
