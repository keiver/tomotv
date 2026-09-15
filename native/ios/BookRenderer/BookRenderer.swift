//
//  BookRenderer.swift
//  TomoTV
//
//  React Native module for the book reader: opens a book file into page images on demand.
//  One serial queue; open books keyed by token, the oldest closed when a third opens.
//

import Foundation
import React

@objc(BookRenderer)
class BookRenderer: NSObject {
    private static let queue = DispatchQueue(label: "dev.keiver.tomotv.books", qos: .userInitiated)
    private static var books: [String: BookSource] = [:]
    private static var order: [String] = []
    private static let maxOpen = 2

    @objc static func requiresMainQueueSetup() -> Bool { false }

    private static var cacheRoot: URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        return caches.appendingPathComponent("books", isDirectory: true)
    }

    private static func directory(for token: String) -> URL { cacheRoot.appendingPathComponent(token, isDirectory: true) }

    @objc func openBook(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let path = config["path"] as? String,
              let width = config["pageWidth"] as? Double, let height = config["pageHeight"] as? Double, width > 0, height > 0
        else {
            reject("invalid_config", "openBook needs path, pageWidth and pageHeight", nil)
            return
        }
        let scale = CGFloat(config["scale"] as? Double ?? 1)
        let fontSize = CGFloat(config["fontSize"] as? Double ?? 18)
        let url = URL(fileURLWithPath: path.hasPrefix("file://") ? String(path.dropFirst(7)).removingPercentEncoding ?? path : path)
        Self.queue.async {
            let token = UUID().uuidString
            BookOpener.purgeStale(root: Self.cacheRoot, keeping: Set(Self.order))
            do {
                let book = try BookOpener.open(url: url, directory: Self.directory(for: token), pageSize: CGSize(width: width, height: height), fontSize: fontSize)
                if let text = book as? TextBook { text.paginateAll() }
                Self.books[token] = book
                Self.order.append(token)
                while Self.order.count > Self.maxOpen, let oldest = Self.order.first {
                    Self.close(oldest)
                }
                _ = scale
                resolve(["token": token, "kind": book.kind.rawValue, "pages": book.pageCount, "title": book.title ?? NSNull()])
            } catch let error as BookError {
                reject(error.code, error.localizedDescription, error)
            } catch {
                reject("open_failed", error.localizedDescription, error)
            }
        }
    }

    @objc func renderPage(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let token = config["token"] as? String, let index = config["index"] as? Int else {
            reject("invalid_config", "renderPage needs token and index", nil)
            return
        }
        let zoom = max(1, min(3, config["zoom"] as? Int ?? 1))
        let scale = CGFloat(config["scale"] as? Double ?? 1)
        let width = config["pageWidth"] as? Double ?? 0, height = config["pageHeight"] as? Double ?? 0
        Self.queue.async {
            guard let book = Self.books[token] else {
                reject("closed", "Book \(token) is not open", nil)
                return
            }
            do {
                let pageSize = width > 0 && height > 0 ? CGSize(width: width, height: height) : (book as? TextBook)?.pageSize ?? CGSize(width: 1920, height: 1080)
                let page = try book.renderPage(index, zoom: zoom, scale: scale, pageSize: pageSize)
                resolve(["uri": page.url.absoluteString, "width": page.width, "height": page.height])
            } catch let error as BookError {
                reject(error.code, error.localizedDescription, error)
            } catch {
                reject("render_failed", error.localizedDescription, error)
            }
        }
    }

    @objc func relayoutBook(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let token = config["token"] as? String,
              let width = config["pageWidth"] as? Double, let height = config["pageHeight"] as? Double, width > 0, height > 0
        else {
            reject("invalid_config", "relayoutBook needs token, pageWidth and pageHeight", nil)
            return
        }
        let fontSize = CGFloat(config["fontSize"] as? Double ?? 18)
        let currentPage = config["page"] as? Int ?? 0
        Self.queue.async {
            guard let book = Self.books[token] as? TextBook else {
                reject("closed", "Book \(token) is not an open text book", nil)
                return
            }
            let anchor = book.anchor(forPage: currentPage)
            let page = book.relayout(pageSize: CGSize(width: width, height: height), fontSize: fontSize, anchor: anchor)
            resolve(["pages": book.pageCount, "page": page])
        }
    }

    @objc func closeBook(_ token: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Self.queue.async {
            Self.close(token)
            resolve(nil)
        }
    }

    private static func close(_ token: String) {
        books[token] = nil
        order.removeAll { $0 == token }
        try? FileManager.default.removeItem(at: directory(for: token))
    }
}
