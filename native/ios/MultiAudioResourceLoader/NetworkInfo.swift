//
//  NetworkInfo.swift
//  TomoTV
//
//  Reports the device's own IPv4 address and netmask so JavaScript can derive
//  the local subnet and sweep it for Jellyfin servers.
//
//  Lives alongside MultiAudioResourceLoader because the target has a single
//  SWIFT_OBJC_BRIDGING_HEADER, configured by plugins/withMultiAudioResourceLoader.js.
//

import Foundation
import Network

/// One TCP connect probe target.
private struct PortTarget {
    let host: String
    let port: UInt16
}

/// Bounded-concurrency TCP connect sweep.
///
/// Exists because an HTTP probe cannot tell "no host at this address" apart from
/// "the host is there and the server is still thinking" — both just run out the
/// clock, so a slow server is written off as an empty address. The TCP handshake
/// separates them: it is answered by the peer's kernel, so it lands in
/// milliseconds even when the server behind it is saturated or cold. Callers use
/// this to find the handful of addresses worth spending a patient HTTP request on.
///
/// Every counter below is touched only on `queue`, and NWConnection callbacks are
/// delivered there too, so none of this needs further locking.
private final class PortScanner {
    private let targets: [PortTarget]
    private let timeout: TimeInterval
    private let maxConcurrent: Int
    private let completion: ([[String: Any]]) -> Void

    private let queue = DispatchQueue(label: "tv.tomo.portscan", qos: .utility)

    private var cursor = 0
    private var active = 0
    private var open: [[String: Any]] = []
    private var completed = false

    init(
        targets: [PortTarget],
        timeout: TimeInterval,
        maxConcurrent: Int,
        completion: @escaping ([[String: Any]]) -> Void
    ) {
        self.targets = targets
        self.timeout = timeout
        self.maxConcurrent = max(1, maxConcurrent)
        self.completion = completion
    }

    /// The scheduled work below captures self strongly, which is what keeps the
    /// scanner alive between `start()` and `completion` without the caller having
    /// to hold it.
    func start() {
        queue.async { self.pump() }
    }

    private func pump() {
        while active < maxConcurrent, cursor < targets.count {
            let target = targets[cursor]
            cursor += 1
            active += 1
            probe(target)
        }

        guard active == 0, cursor >= targets.count, !completed else { return }
        completed = true
        completion(open)
    }

    private func probe(_ target: PortTarget) {
        guard let port = NWEndpoint.Port(rawValue: target.port) else {
            finish(target, isOpen: false)
            return
        }

        let options = NWProtocolTCP.Options()
        options.connectionTimeout = Int(timeout.rounded(.up))
        options.noDelay = true
        let connection = NWConnection(
            host: NWEndpoint.Host(target.host),
            port: port,
            using: NWParameters(tls: nil, tcp: options)
        )

        var settled = false
        func settle(_ isOpen: Bool) {
            guard !settled else { return }
            settled = true
            // Clearing the handler breaks the connection <-> closure cycle.
            connection.stateUpdateHandler = nil
            connection.cancel()
            finish(target, isOpen: isOpen)
        }

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                settle(true)
            case .failed, .cancelled:
                settle(false)
            case .waiting:
                // NWConnection retries out of .waiting (no route, refused, and so
                // on). A sweep wants the first answer, not a retry loop.
                settle(false)
            default:
                break
            }
        }

        // Backstop for a target that never reports any state at all.
        queue.asyncAfter(deadline: .now() + timeout) { settle(false) }
        connection.start(queue: queue)
    }

    private func finish(_ target: PortTarget, isOpen: Bool) {
        if isOpen {
            open.append(["host": target.host, "port": Int(target.port)])
        }
        active -= 1
        pump()
    }
}

/// React Native bridge exposing the active interface's IPv4 configuration.
@objc(NetworkInfo)
class NetworkInfo: NSObject {

    /// Ceiling on a single sweep, so a malformed call can't queue unbounded work.
    private static let maxProbeTargets = 8192

    /// Interface names to rank first, in order. Not an allowlist: anything else
    /// carrying IPv4 is still eligible, it just sorts behind these.
    /// en0 is wired Ethernet on Apple TV and Wi-Fi on iOS; en1 is Wi-Fi on Apple TV.
    private static let preferredInterfaces = ["en0", "en1", "en2"]

    /// Interface families that carry IPv4 but are never a LAN we can sweep:
    /// VPN and other tunnels (utun/ipsec/ppp, usually a /32 point-to-point) and
    /// Apple's peer-to-peer radios (awdl/llw). Reporting one of these would hand
    /// the scanner an address range with no hosts in it.
    private static let excludedPrefixes = ["utun", "ipsec", "ppp", "awdl", "llw", "gif", "stf"]

    /// Resolve `{ ip, netmask, interfaceName }` for the active IPv4 interface,
    /// or `nil` when the device has no usable interface (airplane mode, no link).
    /// Never rejects: callers treat a null result as "scanning unavailable".
    @objc
    func getLocalNetworkInfo(
        _ resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global().async {
            resolve(NetworkInfo.activeIPv4Interface())
        }
    }

    /// Report which of `hosts` accept a TCP connection on any of `ports`, as
    /// `[{ host, port }]`. Resolves an empty array rather than rejecting: a caller
    /// that gets nothing back falls through to probing every address itself.
    ///
    /// Callers should pass hosts in chunks. The sweep has no cancel handle, so
    /// chunking is what keeps a user-facing Stop responsive and progress moving.
    @objc
    func scanOpenPorts(
        _ hosts: [String],
        ports: [NSNumber],
        timeoutMs: NSNumber,
        maxConcurrent: NSNumber,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let portValues: [UInt16] = ports.compactMap { value in
            let raw = value.intValue
            guard raw > 0, raw <= 65535 else { return nil }
            return UInt16(raw)
        }

        guard !hosts.isEmpty, !portValues.isEmpty else {
            resolve([])
            return
        }

        var targets: [PortTarget] = []
        targets.reserveCapacity(min(hosts.count * portValues.count, Self.maxProbeTargets))
        outer: for host in hosts {
            for port in portValues {
                if targets.count >= Self.maxProbeTargets { break outer }
                targets.append(PortTarget(host: host, port: port))
            }
        }

        PortScanner(
            targets: targets,
            // Floor keeps a bad value from turning every probe into an instant miss.
            timeout: max(0.05, timeoutMs.doubleValue / 1000),
            maxConcurrent: maxConcurrent.intValue,
            completion: { resolve($0) }
        ).start()
    }

    /// Walk getifaddrs() and return the best running, non-loopback IPv4 interface
    /// that could plausibly be a LAN, preferring en0/en1/en2 over anything else
    /// (bridge0 from Internet Sharing, USB ethernet, and so on).
    private static func activeIPv4Interface() -> [String: String]? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }

        var best: (rank: Int, info: [String: String])?

        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            guard flags & IFF_UP == IFF_UP,
                  flags & IFF_RUNNING == IFF_RUNNING,
                  flags & IFF_LOOPBACK == 0,
                  // Point-to-point links have no subnet to sweep (a VPN tunnel is
                  // typically a /32), so they can never be the answer here.
                  flags & IFF_POINTOPOINT == 0,
                  let addr = ptr.pointee.ifa_addr,
                  addr.pointee.sa_family == UInt8(AF_INET),
                  let mask = ptr.pointee.ifa_netmask
            else { continue }

            let name = String(cString: ptr.pointee.ifa_name)
            guard !excludedPrefixes.contains(where: name.hasPrefix) else { continue }
            guard let ip = presentation(of: addr), let netmask = presentation(of: mask) else { continue }

            // Preferred interfaces sort ahead of everything else, in listed order.
            // A 169.254 address means DHCP never answered, so it loses to any
            // interface that actually got a lease, however unfashionably named.
            let base = preferredInterfaces.firstIndex(of: name) ?? preferredInterfaces.count
            let rank = ip.hasPrefix("169.254.") ? base + preferredInterfaces.count + 1 : base

            if best == nil || rank < best!.rank {
                best = (rank, ["ip": ip, "netmask": netmask, "interfaceName": name])
            }
        }

        return best?.info
    }

    /// Convert a sockaddr to dotted-quad text via getnameinfo.
    private static func presentation(of addr: UnsafeMutablePointer<sockaddr>) -> String? {
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = getnameinfo(
            addr,
            socklen_t(addr.pointee.sa_len),
            &buffer,
            socklen_t(buffer.count),
            nil,
            0,
            NI_NUMERICHOST
        )
        guard result == 0 else { return nil }
        let text = String(cString: buffer)
        return text.isEmpty ? nil : text
    }
}
