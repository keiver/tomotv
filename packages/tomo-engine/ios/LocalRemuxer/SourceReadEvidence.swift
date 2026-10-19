import Foundation
import Libavformat

/// First-body-byte evidence for one source, independent of whether its media can be opened. Used on the
/// owner's read thread only; the owner keeps this alive until every context it installed on has closed.
final class SourceReadEvidence {
    private typealias IOOpen = @convention(c) (UnsafeMutablePointer<AVFormatContext>?, UnsafeMutablePointer<UnsafeMutablePointer<AVIOContext>?>?,
                                              UnsafePointer<CChar>?, Int32, UnsafeMutablePointer<OpaquePointer?>?) -> Int32
    private var defaultOpen: IOOpen?
    private let onServed: (() -> Void)?
    private(set) var served = false

    init(onServed: (() -> Void)? = nil) {
        self.onServed = onServed
    }

    func install(on context: UnsafeMutablePointer<AVFormatContext>) {
        defaultOpen = context.pointee.io_open
        context.pointee.opaque = Unmanaged.passUnretained(self).toOpaque()
        context.pointee.io_open = Self.open
    }

    /// Peek, then rewind within the AVIO buffer: headers and an empty body prove nothing. Also used by the
    /// manifest read that precedes avformat_open_input, so its first byte starts the same deadline.
    func observeFirstByte(_ io: UnsafeMutablePointer<AVIOContext>) {
        guard !served else { return }
        let before = avio_tell(io)
        _ = avio_r8(io)
        guard avio_tell(io) == before + 1 else { return }
        avio_seek(io, -1, SEEK_CUR)
        served = true
        onServed?()
    }

    private static let open: IOOpen = { context, pb, url, flags, options in
        guard let context, let opaque = context.pointee.opaque else { return -EINVAL }
        let evidence = Unmanaged<SourceReadEvidence>.fromOpaque(opaque).takeUnretainedValue()
        guard let original = evidence.defaultOpen else { return -EINVAL }
        let result = original(context, pb, url, flags, options)
        if result >= 0, flags & AVIO_FLAG_READ != 0, let io = pb?.pointee { evidence.observeFirstByte(io) }
        return result
    }
}
