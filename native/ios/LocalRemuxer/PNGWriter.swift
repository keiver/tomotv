//
//  PNGWriter.swift
//  TomoTV
//
//  Tightly packed RGBA to a PNG file through ImageIO. The FFmpeg build carries no
//  image encoder or muxer on purpose, so every PNG the engine writes comes through
//  here: subtitle bitmaps and chapter keyframes alike.
//

import CoreGraphics
import Foundation
import ImageIO

/// The PNG UTI, spelled out rather than reached through UniformTypeIdentifiers.
/// `UTType.png.identifier` returns exactly this string, and using it directly
/// keeps a framework the engine does not otherwise need out of the link line.
private let PNG_UTI = "public.png" as CFString

enum PNGWriter {
    /// `rgba` is straight (not premultiplied) alpha, `width * 4` bytes per row.
    static func write(_ rgba: Data, width: Int, height: Int, to url: URL) -> Bool {
        guard let provider = CGDataProvider(data: rgba as CFData) else { return false }
        guard let image = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        ) else { return false }

        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, PNG_UTI, 1, nil) else { return false }
        CGImageDestinationAddImage(destination, image, nil)
        return CGImageDestinationFinalize(destination)
    }
}
