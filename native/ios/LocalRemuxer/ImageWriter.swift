//
//  ImageWriter.swift
//  TomoTV
//
//  Tightly packed RGBA to a PNG or JPEG file through ImageIO. The FFmpeg build
//  carries no image encoder or muxer on purpose, so every picture the engine
//  writes comes through here: subtitle bitmaps and chapter keyframes alike.
//

import CoreGraphics
import Foundation
import ImageIO

/// The UTIs spelled out rather than reached through UniformTypeIdentifiers: `UTType.png.identifier`
/// returns exactly this string, and using it directly keeps that framework off the link line.
private let PNG_UTI = "public.png" as CFString
private let JPEG_UTI = "public.jpeg" as CFString

enum ImageWriter {
    /// `rgba` is straight (not premultiplied) alpha, `width * 4` bytes per row.
    static func png(_ rgba: Data, width: Int, height: Int, to url: URL) -> Bool {
        write(rgba, width: width, height: height, alpha: .last, uti: PNG_UTI, properties: nil, to: url)
    }

    /// The alpha byte is skipped: JPEG has no transparency and a keyframe has none to keep.
    static func jpeg(_ rgba: Data, width: Int, height: Int, quality: Double, to url: URL) -> Bool {
        let properties = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        return write(rgba, width: width, height: height, alpha: .noneSkipLast, uti: JPEG_UTI, properties: properties, to: url)
    }

    private static func write(_ rgba: Data, width: Int, height: Int, alpha: CGImageAlphaInfo, uti: CFString, properties: CFDictionary?, to url: URL) -> Bool {
        guard let provider = CGDataProvider(data: rgba as CFData) else { return false }
        guard let image = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: alpha.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        ) else { return false }

        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, uti, 1, nil) else { return false }
        CGImageDestinationAddImage(destination, image, properties)
        return CGImageDestinationFinalize(destination)
    }
}
