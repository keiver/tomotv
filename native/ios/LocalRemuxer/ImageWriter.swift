//
//  ImageWriter.swift
//  TomoTV
//
//  Tightly packed RGBA to a PNG or JPEG file through ImageIO. The FFmpeg build
//  carries no image encoder or muxer on purpose, so every picture the engine
//  writes comes through here: subtitle bitmaps and chapter keyframes alike.
//

import CoreGraphics
import CoreImage
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
    /// `enhanced` runs the picture through Core Image's auto adjustment first.
    static func jpeg(_ rgba: Data, width: Int, height: Int, quality: Double, enhanced: Bool = false, to url: URL) -> Bool {
        let properties = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        return write(rgba, width: width, height: height, alpha: .noneSkipLast, uti: JPEG_UTI, properties: properties, enhanced: enhanced, to: url)
    }

    private static let context = CIContext()

    /// The enhance pass of Core Image's auto adjustment, read off the picture itself: vibrance,
    /// a tone curve and a shadow lift. Faces and red eye are not looked for.
    private static func enhance(_ image: CGImage) -> CGImage? {
        var picture = CIImage(cgImage: image)
        let options: [CIImageAutoAdjustmentOption: Any] = [.enhance: true, .redEye: false, .features: [CIFeature](), .crop: false, .level: false]
        for filter in picture.autoAdjustmentFilters(options: options) {
            filter.setValue(picture, forKey: kCIInputImageKey)
            guard let output = filter.outputImage else { return nil }
            picture = output
        }
        return context.createCGImage(picture, from: picture.extent)
    }

    private static func write(_ rgba: Data, width: Int, height: Int, alpha: CGImageAlphaInfo, uti: CFString, properties: CFDictionary?, enhanced: Bool = false, to url: URL) -> Bool {
        guard let provider = CGDataProvider(data: rgba as CFData) else { return false }
        guard var image = CGImage(
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
        if enhanced, let better = enhance(image) { image = better }

        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, uti, 1, nil) else { return false }
        CGImageDestinationAddImage(destination, image, properties)
        return CGImageDestinationFinalize(destination)
    }
}
