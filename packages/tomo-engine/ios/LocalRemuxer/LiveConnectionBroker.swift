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

    /// A read's key when the app named none: the URL's host and port, so two servers on one address never share a budget.
    static func key(forURL url: String) -> String {
        guard let parsed = URL(string: url), let host = parsed.host, !host.isEmpty else { return "-" }
        return parsed.port.map { "\(host):\($0)" } ?? host
    }

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
        /// The origin admitted this read's own open (never the server copy's).
        fileprivate var opened = false
        fileprivate weak var broker: LiveConnectionBroker?

        fileprivate init(key: String, priority: Priority, broker: LiveConnectionBroker, onRevoke: @escaping () -> Void) {
            self.key = key
            self.priority = priority
            self.broker = broker
            self.onRevoke = onRevoke
        }

        /// Called once the connection is closed; a revoked lease frees its slot only here. `counted` false: the origin
        /// never admitted the read, so it has nothing of it left to count.
        func release(counted: Bool = true) { broker?.release(self, counted: counted) }
    }

    private let cond = NSCondition()
    /// A key with no budget is unlimited until its provider shows its limit.
    private var budgets: [String: Int] = [:]
    private var active: [String: [Lease]] = [:]
    /// When a read last closed per key: the origin frees its count a moment after, so an open refused
    /// right then is the origin catching up, not a verdict.
    private var closedAt: [String: Date] = [:]
    /// Keys whose origin admitted a read while a preview it had admitted was still held: room beside a preview.
    private var roomShown = Set<String>()
    /// Per key, the channels whose sweep lost a whole fight beside a preview since the origin last showed room.
    private var lostBesidePreview: [String: Set<String>] = [:]
    /// Keys that never showed room and refused two channels beside a preview: a full origin that teaches no number.
    private var previewsStopped = Set<String>()

    /// A budget under the reads held revokes the lowest ones below playback until the key fits it, and any
    /// preview left with no slot spare beside it.
    func setBudget(_ budget: Int, for key: String) {
        cond.lock()
        budgets[key] = budget > 0 ? budget : nil
        // The viewer's number replaces what the origin's refusals showed.
        previewsStopped.remove(key)
        lostBesidePreview[key] = nil
        var victims = budget > 0 ? victimsLocked(key: key, limit: budget, below: .playback, keeping: nil) : []
        if budget > 0 { victims += previewsWithoutSpareLocked(key: key, limit: budget) }
        cond.broadcast()
        cond.unlock()
        victims.forEach { $0.onRevoke() }
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

    /// Whether one more read fits the key's budget now; a key with no budget always has room.
    func hasSpare(for key: String) -> Bool {
        cond.lock()
        defer { cond.unlock() }
        return hasRoomLocked(key)
    }

    /// A session a player adopted from the ring or a preview now ranks as playback: nothing below takes its slot.
    func setPriority(_ priority: Priority, of lease: Lease) {
        cond.lock()
        lease.priority = priority
        cond.unlock()
    }

    /// A slot now or nil, never taking one from anyone. A preview also leaves one slot spare for the sweep, the
    /// terms it holds on, and none is granted on a key that refused two channels beside one without ever showing room.
    func tryAcquire(key: String, priority: Priority, onRevoke: @escaping () -> Void) -> Lease? {
        cond.lock()
        defer { cond.unlock() }
        if priority == .preview, previewsStopped.contains(key) { return nil }
        guard hasRoomLocked(key, spare: priority == .preview ? 1 : 0) else { return nil }
        return grantLocked(key: key, priority: priority, onRevoke: onRevoke)
    }

    /// A slot within `timeout`, revoking the lowest lower-priority lease on a full key and waiting for its
    /// connection to close, so the origin never counts both. A sweep revokes nothing and waits for the slot
    /// to free. nil at the timeout, or when a ring finds nothing below it to revoke.
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
                    // Playback waits out the session it replaces, whose lease frees only once its thread exits;
                    // the sweep waits for whatever holds the slot to close.
                    if priority == .playback || priority == .sweep, cond.wait(until: deadline) { continue }
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

    func recentlyClosed(key: String, within seconds: TimeInterval) -> Bool {
        cond.lock()
        defer { cond.unlock() }
        return closedAt[key].map { Date().timeIntervalSince($0) < seconds } ?? false
    }

    /// The origin refused `lease`'s open while this device held other connections to it. The lowest reads below
    /// `lease` are revoked to make room (a preview takes nothing from anyone), and so is a preview left with no
    /// slot spare; with `learn`, those held were the origin's limit and the budget becomes their count. True when
    /// room is coming: another read was revoked, or `lease` is playback and waits out what it replaces.
    @discardableResult
    func noteRefusal(of lease: Lease, learn: Bool = true) -> Bool {
        cond.lock()
        let others = (active[lease.key] ?? []).filter { $0 !== lease }
        guard !others.isEmpty else {
            cond.unlock()
            return false
        }
        if learn { learnLocked(key: lease.key, limit: others.count) }
        var victims = lease.priority == .preview ? [] : victimsLocked(key: lease.key, limit: min(budgets[lease.key] ?? .max, others.count), below: lease.priority, keeping: lease)
        victims += previewsWithoutSpareLocked(key: lease.key, limit: budgets[lease.key] ?? others.count)
        cond.unlock()
        victims.forEach { $0.onRevoke() }
        return victims.contains { $0 !== lease } || lease.priority == .playback
    }

    /// The origin admitted `lease`'s own open. Admitted beside a preview it had admitted, it shows the key has
    /// room beside one, and the channels that lost a fight there since are forgotten.
    func noteOpened(_ lease: Lease) {
        cond.lock()
        lease.opened = true
        if (active[lease.key] ?? []).contains(where: { $0 !== lease && $0.opened && $0.priority == .preview }) {
            roomShown.insert(lease.key)
            lostBesidePreview[lease.key] = nil
        }
        cond.unlock()
    }

    /// A sweep refused for its whole fight while this device held other reads on the key: a 4xx teaches their count
    /// and a preview left no slot spare yields, unless the origin has shown room beside a preview and `channel` is
    /// the only one to lose since (its own refusal, not the origin's). A key that never showed room stops previews
    /// at the second channel lost beside one.
    func noteLostFight(of lease: Lease, channel: String, learn: Bool) {
        cond.lock()
        let others = (active[lease.key] ?? []).filter { $0 !== lease }
        guard !others.isEmpty else {
            cond.unlock()
            return
        }
        let besidePreview = others.contains { $0.priority == .preview }
        if besidePreview { lostBesidePreview[lease.key, default: []].insert(channel) }
        let lost = lostBesidePreview[lease.key]?.count ?? 0
        guard !roomShown.contains(lease.key) || lost >= 2 else {
            cond.unlock()
            return
        }
        if learn { learnLocked(key: lease.key, limit: others.count) }
        if besidePreview, !roomShown.contains(lease.key), lost >= 2 { previewsStopped.insert(lease.key) }
        let victims = previewsWithoutSpareLocked(key: lease.key, limit: budgets[lease.key] ?? others.count)
        cond.unlock()
        victims.forEach { $0.onRevoke() }
    }

    /// `lease`'s live input dropped just after a read on its origin opened while both were held: the budget becomes what
    /// was held besides it, the reads below `lease` go (a preview takes nothing) and a preview left no slot spare. True for a kick.
    @discardableResult
    func noteLost(_ lease: Lease) -> Bool {
        cond.lock()
        let others = (active[lease.key] ?? []).filter { $0 !== lease }
        let recent = { (candidate: Lease) in Date().timeIntervalSince(candidate.grantedAt) < 10 }
        guard !others.isEmpty, recent(lease) || others.contains(where: { $0.grantedAt > lease.grantedAt && recent($0) }) else {
            cond.unlock()
            return false
        }
        learnLocked(key: lease.key, limit: others.count)
        var victims = lease.priority == .preview ? [] : victimsLocked(key: lease.key, limit: budgets[lease.key] ?? others.count, below: lease.priority, keeping: lease)
        victims += previewsWithoutSpareLocked(key: lease.key, limit: budgets[lease.key] ?? others.count)
        cond.unlock()
        victims.forEach { $0.onRevoke() }
        return true
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

    /// Reads under `priority` to revoke until the key holds `limit`, lowest first; `keeping` is never one of them.
    private func victimsLocked(key: String, limit: Int, below priority: Priority, keeping: Lease?) -> [Lease] {
        let held = active[key] ?? []
        var over = held.count - limit
        var victims: [Lease] = []
        for candidate in held.filter({ $0 !== keeping && $0.priority < priority && !$0.revoking }).sorted(by: { $0.priority < $1.priority }) where over > 0 {
            candidate.revoking = true
            victims.append(candidate)
            over -= 1
        }
        return victims
    }

    /// Previews left no slot spare beside them under `limit`, the terms they were granted on (`tryAcquire`); marked
    /// revoking. The sweep is not counted: the spare slot is the sweep's.
    private func previewsWithoutSpareLocked(key: String, limit: Int) -> [Lease] {
        var victims: [Lease] = []
        for preview in (active[key] ?? []).filter({ $0.priority == .preview && !$0.revoking }) {
            let beside = (active[key] ?? []).filter { $0 !== preview && !$0.revoking && $0.priority > .sweep }.count
            guard beside + 1 >= limit else { continue }
            preview.revoking = true
            victims.append(preview)
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

    private func release(_ lease: Lease, counted: Bool) {
        cond.lock()
        if counted { closedAt[lease.key] = Date() }
        active[lease.key]?.removeAll { $0 === lease }
        if active[lease.key]?.isEmpty == true { active[lease.key] = nil }
        cond.broadcast()
        cond.unlock()
    }
}
