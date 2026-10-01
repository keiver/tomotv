//  TopShelfReload.swift
//  Tells tvOS the Top Shelf has new content after services/topShelfChannels.ts rewrites its row.

import Foundation
#if os(tvOS)
import TVServices
#endif

@objc(TopShelfReload)
class TopShelfReload: NSObject {

    @objc
    func contentDidChange() {
        #if os(tvOS)
        TVTopShelfContentProvider.topShelfContentDidChange()
        #endif
    }
}
