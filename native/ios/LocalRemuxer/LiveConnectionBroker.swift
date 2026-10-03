//
//  LiveConnectionBroker.swift
//  TomoTV
//
//  Every connection the engine holds to a live origin takes a lease on that origin's budget first. A budget is
//  learned from the provider itself: a refusal, or a kick, while this device holds others sets it to what was held.
//

import Foundation

final class LiveConnectionBroker {
    static let shared = LiveConnectionBroker()

    /// Who yields to whom: a higher priority revokes the lowest lower one when the budget is full.
    enum Priority: Int, Comparable {
        case sweep = 0, preview, ring, playback

        static func < (lhs: Priority, rhs: Priority) -> Bool { lhs.rawValue < rhs.rawValue }

        init(name: String?) {
            switch name {
            case "preview": self = .preview
            case "ring": self = .ring
            case "playback": self = .playback
            default: self = .sweep
            }
        }
    }

    final class Lease {
        let key: String
        fileprivate(set) var priority: Priority
        fileprivate let grantedAt = Date()
        fileprivate let onRevoke: () -> Void
        fileprivate var revoking = false
        fileprivate weak var broker: LiveConnectionBroker?

        fileprivate init(key: String, priority: Priority, broker: LiveConnectionBroker, onRevoke: @escaping () -> Void) {
            self.key = key
            self.priority = priority
            self.broker = broker
            self.onRevoke = onRevoke
        }

        /// Called once the connection is closed; a revoked lease frees its slot only here.
        func release() { broker?.release(self) }
    }

    private let cond = NSCondition()
    /// A key with no budget is unlimited until its provider shows its limit.
    private var budgets: [String: Int] = [:]
    private var active: [String: [Lease]] = [:]
    /// When a revoked read last closed per key: the origin frees its count a moment after, so an open refused
    /// right then is the origin catching up, not a verdict.
    private var yieldedAt: [String: Date] = [:]

    func setBudget(_ budget: Int, for key: String) {
        cond.lock()
        budgets[key] = budget > 0 ? budget : nil
        cond.broadcast()
        cond.unlock()
    }

    func budget(for key: String) -> Int? {
        cond.lock()
        defer { cond.unlock() }
        return budgets[key]
    }

    func activeCount(for key: String) -> Int {
        cond.lock()
        defer { cond.unlock() }
        return active[key]?.count ?? 0
    }

    /// A session a player adopted from the ring or a preview now ranks as playback: nothing below takes its slot.
    func setPriority(_ priority: Priority, of lease: Lease) {
        cond.lock()
        lease.priority = priority
        cond.unlock()
    }

    /// A slot now or nil, never taking one from anyone: the sweep's terms. A preview also leaves one slot spare,
    /// so on a provider allowing one connection the sweep keeps refreshing the cards.
    func tryAcquire(key: String, priority: Priority, onRevoke: @escaping () -> Void) -> Lease? {
        cond.lock()
        defer { cond.unlock() }
        guard hasRoomLocked(key, spare: priority == .preview ? 1 : 0) else { return nil }
        return grantLocked(key: key, priority: priority, onRevoke: onRevoke)
    }

    /// A slot within `timeout`, revoking the lowest lower-priority lease on a full key and waiting for its
    /// connection to close, so the origin never counts both. nil when nothing below this priority holds one.
    func acquire(key: String, priority: Priority, timeout: TimeInterval, onRevoke: @escaping () -> Void) -> Lease? {
        // A preview never takes a slot from anyone and leaves one spare.
        if priority == .preview { return tryAcquire(key: key, priority: priority, onRevoke: onRevoke) }
        let deadline = Date().addingTimeInterval(timeout)
        cond.lock()
        defer { cond.unlock() }
        while !hasRoomLocked(key) {
            let waitingOn = (active[key] ?? []).contains { $0.revoking }
            if !waitingOn {
                guard let victim = (active[key] ?? []).filter({ $0.priority < priority }).min(by: { $0.priority < $1.priority }) else {
                    // Playback waits out the session it replaces, whose lease frees only once its thread exits.
                    if priority == .playback, cond.wait(until: deadline) { continue }
                    return nil
                }
                victim.revoking = true
                cond.unlock()
                victim.onRevoke()
                cond.lock()
                continue
            }
            if !cond.wait(until: deadline) { return nil }
        }
        return grantLocked(key: key, priority: priority, onRevoke: onRevoke)
    }

    func recentlyYielded(key: String, within seconds: TimeInterval) -> Bool {
        cond.lock()
        defer { cond.unlock() }
        return yieldedAt[key].map { Date().timeIntervalSince($0) < seconds } ?? false
    }

    /// The origin refused `lease`'s open while this device held other connections to it: those were its limit.
    /// The budget becomes that count and the lowest reads below `lease` are revoked to make room; true when learned.
    @discardableResult
    func noteRefusal(of lease: Lease) -> Bool {
        cond.lock()
        let others = (active[lease.key] ?? []).filter { $0 !== lease }
        guard !others.isEmpty else {
            cond.unlock()
            return false
        }
        learnLocked(key: lease.key, limit: others.count)
        let victims = victimsLocked(key: lease.key, below: lease.priority, keeping: lease)
        cond.unlock()
        victims.forEach { $0.onRevoke() }
        return true
    }

    /// `lease`'s live input dropped just after it or another read on its origin opened while both were held: the origin
    /// kicked one to admit the other. The budget becomes what was held besides it, and the reads below `lease` go.
    func noteLost(_ lease: Lease) {
        cond.lock()
        let others = (active[lease.key] ?? []).filter { $0 !== lease }
        let recent = { (candidate: Lease) in Date().timeIntervalSince(candidate.grantedAt) < 10 }
        guard !others.isEmpty, recent(lease) || others.contains(where: { $0.grantedAt > lease.grantedAt && recent($0) }) else {
            cond.unlock()
            return
        }
        learnLocked(key: lease.key, limit: others.count)
        let victims = victimsLocked(key: lease.key, below: lease.priority, keeping: lease)
        cond.unlock()
        victims.forEach { $0.onRevoke() }
    }

    /// Whether `lease` opened beside another read on its origin whose limit is not known: such a read opens without
    /// FFmpeg's reconnect, so a kick ends it instead of reconnecting and kicking the other back.
    func sharesUnknownOrigin(_ lease: Lease) -> Bool {
        cond.lock()
        defer { cond.unlock() }
        return budgets[lease.key] == nil && (active[lease.key]?.count ?? 0) > 1
    }

    private func learnLocked(key: String, limit: Int) {
        budgets[key] = max(1, min(budgets[key] ?? .max, limit))
        cond.broadcast()
    }

    /// Reads under `priority` to revoke until `keeping` fits the budget, lowest first.
    private func victimsLocked(key: String, below priority: Priority, keeping: Lease) -> [Lease] {
        guard let budget = budgets[key] else { return [] }
        let held = active[key] ?? []
        var over = held.count - budget
        var victims: [Lease] = []
        for candidate in held.filter({ $0 !== keeping && $0.priority < priority && !$0.revoking }).sorted(by: { $0.priority < $1.priority }) where over > 0 {
            candidate.revoking = true
            victims.append(candidate)
            over -= 1
        }
        return victims
    }

    private func hasRoomLocked(_ key: String, spare: Int = 0) -> Bool {
        guard let budget = budgets[key] else { return true }
        return (active[key]?.count ?? 0) + spare < budget
    }

    private func grantLocked(key: String, priority: Priority, onRevoke: @escaping () -> Void) -> Lease {
        let lease = Lease(key: key, priority: priority, broker: self, onRevoke: onRevoke)
        active[key, default: []].append(lease)
        return lease
    }

    private func release(_ lease: Lease) {
        cond.lock()
        if lease.revoking { yieldedAt[lease.key] = Date() }
        active[lease.key]?.removeAll { $0 === lease }
        if active[lease.key]?.isEmpty == true { active[lease.key] = nil }
        cond.broadcast()
        cond.unlock()
    }
}
