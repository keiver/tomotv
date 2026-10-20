//
//  TopShelfReload.swift
//  TomoTV
//
//  Tells tvOS the Top Shelf content changed, so it asks the extension again. tvOS only:
//  plugins/withTopShelfExtension.js adds it to the tvOS app target alone.
//

import Foundation
import React
import TVServices

@objc(TopShelfReload)
class TopShelfReload: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc func reload(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        TVTopShelfContentProvider.topShelfContentDidChange()
        resolve(nil)
    }
}
