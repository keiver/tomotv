//
//  Gunzip.swift
//  TomoTV
//
//  Streaming gzip inflate through zlib, gzip members back to back included. Input that does not
//  open with the gzip magic passes through untouched, so one reader takes .xml and .xml.gz alike.
//

import Foundation
import zlib

final class Gunzip {
    enum Failure: Error, Equatable {
        case corrupt(Int32)
        case truncated
    }

    private enum Mode {
        case sniffing, gzip, plain
    }

    private var stream = z_stream()
    private var mode = Mode.sniffing
    private var zlibOpen = false
    private var memberOpen = false
    private var membersDone = 0
    /// Bytes after the last member that are not another member (padding): ignored, as gzip(1) does.
    private var trailing = false
    private var sniffed: [UInt8] = []
    private var output = [UInt8](repeating: 0, count: 256 * 1024)
    private(set) var inflatedBytes = 0

    deinit {
        if zlibOpen { inflateEnd(&stream) }
    }

    /// Feeds compressed bytes; `emit` sees each inflated run, valid only for the call.
    func push(_ input: UnsafeRawBufferPointer, emit: (UnsafeRawBufferPointer) throws -> Void) throws {
        guard input.count > 0 else { return }
        switch mode {
        case .plain:
            inflatedBytes += input.count
            try emit(input)
        case .gzip:
            try inflate(input, emit: emit)
        case .sniffing:
            sniffed.append(contentsOf: input)
            guard sniffed.count >= 2 else { return }
            let head = sniffed
            sniffed = []
            mode = head[0] == 0x1F && head[1] == 0x8B ? .gzip : .plain
            try head.withUnsafeBytes { try push($0, emit: emit) }
        }
    }

    /// Flushes a sniff shorter than the magic and refuses a gzip stream cut short.
    func finish(emit: (UnsafeRawBufferPointer) throws -> Void) throws {
        if mode == .sniffing, !sniffed.isEmpty {
            mode = .plain
            let head = sniffed
            sniffed = []
            try head.withUnsafeBytes { try push($0, emit: emit) }
        }
        if mode == .gzip, memberOpen { throw Failure.truncated }
    }

    private func inflate(_ input: UnsafeRawBufferPointer, emit: (UnsafeRawBufferPointer) throws -> Void) throws {
        guard let base = input.baseAddress, !trailing else { return }
        if !zlibOpen {
            // 16 + MAX_WBITS: a gzip wrapper, not a zlib one.
            let rc = inflateInit2_(&stream, 16 + MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
            guard rc == Z_OK else { throw Failure.corrupt(rc) }
            zlibOpen = true
        }
        stream.next_in = UnsafeMutablePointer(mutating: base.assumingMemoryBound(to: Bytef.self))
        stream.avail_in = uInt(input.count)
        while stream.avail_in > 0 {
            if !memberOpen {
                if membersDone > 0, stream.next_in[0] != 0x1F {
                    trailing = true
                    return
                }
                // The next member of a concatenated gzip file starts on the same stream.
                if inflateReset(&stream) != Z_OK { throw Failure.corrupt(Z_STREAM_ERROR) }
                memberOpen = true
            }
            let (rc, produced) = try step(emit)
            if rc == Z_BUF_ERROR, produced == 0 { return }
        }
        // Input spent with the output buffer full: zlib may still hold pending output.
        while memberOpen {
            let (rc, produced) = try step(emit)
            if rc == Z_BUF_ERROR || produced == 0 { return }
        }
    }

    /// One inflate call into the output buffer; emits what it produced and closes a finished member.
    private func step(_ emit: (UnsafeRawBufferPointer) throws -> Void) throws -> (Int32, Int) {
        let capacity = output.count
        let (rc, produced) = output.withUnsafeMutableBytes { out -> (Int32, Int) in
            stream.next_out = out.baseAddress!.assumingMemoryBound(to: Bytef.self)
            stream.avail_out = uInt(capacity)
            let rc = zlib.inflate(&stream, Z_NO_FLUSH)
            return (rc, capacity - Int(stream.avail_out))
        }
        if produced > 0 {
            inflatedBytes += produced
            try output.withUnsafeBytes { try emit(UnsafeRawBufferPointer(rebasing: $0[0 ..< produced])) }
        }
        switch rc {
        case Z_STREAM_END:
            memberOpen = false
            membersDone += 1
        case Z_OK, Z_BUF_ERROR:
            break
        default:
            throw Failure.corrupt(rc)
        }
        return (rc, produced)
    }
}
