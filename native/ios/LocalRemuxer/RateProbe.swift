import Foundation

/// Times a URL's body through a RateMeter from its first byte until the rate is steady or the budget
/// runs out. `beside` counts what other transfers carried meanwhile, so a shared link reads whole.
final class RateProbe: NSObject, URLSessionDataDelegate {
    struct Outcome {
        let reading: RateMeter.Reading?
        let failure: LinkProbeFailure?
        /// Each settled 100ms sample's rate, for reading a run back.
        var samples: [Double] = []
    }

    private let request: URLRequest
    private let budget: Double
    private let firstByteWithin: Double
    /// Asks again when a body ends first: a fixed-size test body can be shorter than the budget.
    private let repeats: Bool
    private let beside: () -> Int64
    private let clock: () -> Double
    private let done = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var meter = RateMeter()
    private var firstByteAt: Double?
    private var besideSeen: Int64 = 0
    private var transfer = 0
    private var finished = false
    private var failure: LinkProbeFailure?

    init(request: URLRequest, budget: Double, firstByteWithin: Double, repeats: Bool = false,
         beside: @escaping () -> Int64 = { 0 }, clock: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime }) {
        self.request = request
        self.budget = budget
        self.firstByteWithin = firstByteWithin
        self.repeats = repeats
        self.beside = beside
        self.clock = clock
    }

    /// Blocks until the probe has its answer. A nil reading means nothing flowed.
    func run() -> Outcome {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        session.dataTask(with: request).resume()
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
        let outcome = Outcome(reading: firstByteAt == nil ? nil : meter.reading(), failure: failure, samples: meter.samples())
        lock.unlock()
        session.invalidateAndCancel()
        return outcome
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        guard !(200..<300).contains(status) else { return completionHandler(.allow) }
        lock.lock()
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
        guard !finished else { return lock.unlock() }
        let now = clock()
        if firstByteAt == nil {
            firstByteAt = now
            besideSeen = carried
        }
        meter.received(transfer, bytes: data.count + Int(max(0, carried - besideSeen)), at: now)
        besideSeen = carried
        let stop = meter.isSteady || now - (firstByteAt ?? now) >= budget
        if stop { finished = true }
        lock.unlock()
        if stop {
            dataTask.cancel()
            done.signal()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard !finished else { return lock.unlock() }
        meter.ended(transfer)
        let again = error == nil && repeats && firstByteAt != nil
        if again {
            transfer += 1
        } else {
            if error != nil { failure = .transient(0) }
            finished = true
        }
        lock.unlock()
        if again { session.dataTask(with: request).resume() } else { done.signal() }
    }
}
