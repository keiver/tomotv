//
//  LyricsListView.swift
//  TomoTV
//
//  A song's lines the way Apple Music sets them: bold, left aligned, the sung line white and
//  the rest dimmed, following playback. One view for all three places lyrics appear: the
//  Apple TV backdrop (no interaction), its swipe-up list, and the phone's list beside the player.
//

import UIKit

final class LyricsListView: UIView, UITableViewDataSource, UITableViewDelegate {

    /// Seconds of the line the viewer picked. Only synced lines can be picked.
    var onSelect: ((Double) -> Void)?
    /// Each line's time, shown beside it in the Apple TV list.
    var showsTimes = false

    private let table = UITableView(frame: .zero, style: .plain)
    private let faded = UIView()
    private let fade = CAGradientLayer()
    private let caption = UILabel()
    private var lyrics: Lyrics?
    private var currentLine: Int?
    private var sungLength = 0
    /// A viewer reading ahead is left alone until this passes.
    private var followAfter = Date.distantPast

    #if os(tvOS)
    private static let font = UIFont.systemFont(ofSize: 50, weight: .bold)
    private static let rowSpacing: CGFloat = 34
    private static let captionFont = UIFont.systemFont(ofSize: 25, weight: .medium)
    private static let captionHeight: CGFloat = 60
    #else
    private static let font = UIFontMetrics(forTextStyle: .title1).scaledFont(for: .systemFont(ofSize: 28, weight: .bold))
    private static let rowSpacing: CGFloat = 22
    private static let captionFont = UIFont.preferredFont(forTextStyle: .footnote)
    private static let captionHeight: CGFloat = 36
    #endif
    private static let dimmed = UIColor(white: 1, alpha: 0.38)
    private static let followPause: TimeInterval = 4

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        table.backgroundColor = .clear
        table.showsVerticalScrollIndicator = false
        table.dataSource = self
        table.delegate = self
        table.register(LyricLineCell.self, forCellReuseIdentifier: LyricLineCell.reuseIdentifier)
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 90
        #if !os(tvOS)
        table.separatorStyle = .none
        #endif
        // The fade masks a wrapper, not the table: a mask on a scroll view travels with its content.
        fade.colors = [UIColor.clear.cgColor, UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]
        faded.layer.mask = fade
        faded.addSubview(table)
        addSubview(faded)

        caption.font = Self.captionFont
        caption.textColor = UIColor(white: 1, alpha: 0.55)
        caption.isHidden = true
        addSubview(caption)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        faded.frame = bounds
        table.frame = bounds
        fade.frame = bounds
        // On the lines' own leading edge, which a cell knows and the table does not publish.
        let leading = table.visibleCells.first.map { $0.contentView.convert(CGPoint(x: $0.contentView.layoutMargins.left, y: 0), to: self).x } ?? table.layoutMargins.left
        caption.frame = CGRect(x: leading, y: 0, width: max(0, bounds.width - leading), height: Self.captionHeight)
        applyInsets()
    }

    /// The sung line rides a third of the way down, so what comes next is always in view. Plain
    /// text has no such line and starts just clear of the top fade.
    private func applyInsets() {
        let synced = lyrics?.synced ?? false
        // Synced lines dissolve well before the edge; text to be read keeps the page. A caption
        // keeps its own strip clear of the lines passing under it.
        let clear = NSNumber(value: caption.isHidden || bounds.height <= 0 ? 0 : Double(Self.captionHeight / bounds.height))
        let opaque = NSNumber(value: clear.doubleValue + (synced ? 0.1 : 0.08))
        fade.locations = synced ? [clear, opaque, 0.72, 1] : [clear, opaque, 0.9, 1]
        let inset = UIEdgeInsets(top: bounds.height * (synced ? 0.3 : 0.12), left: 0, bottom: bounds.height * (synced ? 0.6 : 0.3), right: 0)
        guard table.contentInset != inset else { return }
        table.contentInset = inset
        if currentLine == nil {
            table.setContentOffset(CGPoint(x: 0, y: -inset.top), animated: false)
        } else {
            scrollToCurrent(animated: false)
        }
    }

    func setLyrics(_ lyrics: Lyrics?) {
        let sameLines = lyrics != nil && self.lyrics?.lines.map(\.text) == lyrics?.lines.map(\.text)
        self.lyrics = lyrics
        showCaption(lyrics?.caption)
        sungLength = 0
        // Better timing for the lines already on screen leaves the viewer where they are.
        if sameLines {
            applyInsets()
            for case let cell as LyricLineCell in table.visibleCells {
                if let index = table.indexPath(for: cell)?.row { configure(cell, at: index) }
            }
            return
        }
        currentLine = nil
        followAfter = .distantPast
        table.reloadData()
        applyInsets()
        table.setContentOffset(CGPoint(x: 0, y: -table.contentInset.top), animated: false)
    }

    /// Pinned above the lines rather than scrolled with them: it has to be seen at any point in the song.
    private func showCaption(_ text: String?) {
        caption.text = text
        caption.isHidden = text?.isEmpty ?? true
        setNeedsLayout()
    }

    /// Moves the sung line and its word fill to the player's clock.
    func update(time: Double) {
        guard let lyrics, lyrics.synced else { return }
        let line = lyrics.lineIndex(at: time)
        let sung = line.map { lyrics.sungLength(inLine: $0, at: time) } ?? 0
        guard line != currentLine || sung != sungLength else { return }
        let previous = currentLine
        let lineChanged = line != currentLine
        currentLine = line
        sungLength = sung
        for index in Set([previous, line].compactMap { $0 }) {
            guard let cell = table.cellForRow(at: IndexPath(row: index, section: 0)) as? LyricLineCell else { continue }
            configure(cell, at: index)
        }
        if lineChanged { scrollToCurrent(animated: true) }
    }

    private func scrollToCurrent(animated: Bool) {
        guard let currentLine, bounds.height > 0, Date() >= followAfter, !table.isTracking, !table.isDecelerating else { return }
        guard currentLine < table.numberOfRows(inSection: 0) else { return }
        table.scrollToRow(at: IndexPath(row: currentLine, section: 0), at: .top, animated: animated)
    }

    private func configure(_ cell: LyricLineCell, at index: Int) {
        guard let lyrics else { return }
        let line = lyrics.lines[index]
        let text = NSMutableAttributedString(string: line.text.isEmpty ? " " : line.text, attributes: [.font: Self.font, .foregroundColor: Self.dimmed])
        if !lyrics.synced {
            text.addAttribute(.foregroundColor, value: UIColor.white, range: NSRange(location: 0, length: text.length))
        } else if index == currentLine {
            text.addAttribute(.foregroundColor, value: UIColor.white, range: NSRange(location: 0, length: min(sungLength, text.length)))
        }
        cell.show(text, time: showsTimes ? line.start.map(Self.clock) : nil, spacing: Self.rowSpacing)
    }

    private static func clock(_ seconds: Double) -> String {
        let whole = Int(seconds.rounded(.down))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    // MARK: - UITableViewDataSource

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        lyrics?.lines.count ?? 0
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: LyricLineCell.reuseIdentifier, for: indexPath)
        if let lineCell = cell as? LyricLineCell { configure(lineCell, at: indexPath.row) }
        return cell
    }

    // MARK: - UITableViewDelegate

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: false)
        guard let start = lyrics?.lines[indexPath.row].start else { return }
        followAfter = .distantPast
        onSelect?(start)
    }

    func tableView(_ tableView: UITableView, shouldHighlightRowAt indexPath: IndexPath) -> Bool {
        lyrics?.lines[indexPath.row].start != nil
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        followAfter = Date().addingTimeInterval(Self.followPause)
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        followAfter = Date().addingTimeInterval(Self.followPause)
    }

    #if os(tvOS)
    func tableView(_ tableView: UITableView, canFocusRowAt indexPath: IndexPath) -> Bool {
        true
    }

    /// Focus enters on the line being sung.
    func indexPathForPreferredFocusedView(in tableView: UITableView) -> IndexPath? {
        guard let lyrics, !lyrics.lines.isEmpty else { return nil }
        return IndexPath(row: currentLine ?? 0, section: 0)
    }

    func tableView(_ tableView: UITableView, didUpdateFocusIn context: UITableViewFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
        // Moving through the lines by hand is reading ahead, the same as a drag on the phone.
        if context.nextFocusedIndexPath != nil { followAfter = Date().addingTimeInterval(Self.followPause) }
    }
    #endif
}

private final class LyricLineCell: UITableViewCell {
    static let reuseIdentifier = "LyricLineCell"

    private let line = UILabel()
    private let time = UILabel()
    private var bottom: NSLayoutConstraint?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .none
        #if os(tvOS)
        focusStyle = .custom
        #endif

        line.numberOfLines = 0
        line.translatesAutoresizingMaskIntoConstraints = false
        time.font = .monospacedDigitSystemFont(ofSize: 26, weight: .medium)
        time.textColor = UIColor(white: 1, alpha: 0.6)
        time.textAlignment = .right
        time.translatesAutoresizingMaskIntoConstraints = false
        time.setContentHuggingPriority(.required, for: .horizontal)
        time.setContentCompressionResistancePriority(.required, for: .horizontal)
        contentView.addSubview(line)
        contentView.addSubview(time)

        let bottom = line.bottomAnchor.constraint(equalTo: contentView.bottomAnchor)
        self.bottom = bottom
        NSLayoutConstraint.activate([
            line.topAnchor.constraint(equalTo: contentView.topAnchor),
            line.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
            line.trailingAnchor.constraint(lessThanOrEqualTo: time.leadingAnchor, constant: -24),
            bottom,
            time.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
            time.firstBaselineAnchor.constraint(equalTo: line.firstBaselineAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private var text = NSAttributedString()

    func show(_ text: NSAttributedString, time clock: String?, spacing: CGFloat) {
        self.text = text
        time.text = clock
        time.isHidden = clock == nil
        bottom?.constant = -spacing
        render()
    }

    /// Focus is the whole line at full strength with its time lit; no platter, the text is the list.
    private func render() {
        guard isFocused else {
            line.attributedText = text
            time.textColor = UIColor(white: 1, alpha: 0.6)
            return
        }
        let lit = NSMutableAttributedString(attributedString: text)
        lit.addAttribute(.foregroundColor, value: UIColor.white, range: NSRange(location: 0, length: lit.length))
        line.attributedText = lit
        time.textColor = .white
    }

    #if os(tvOS)
    override func didUpdateFocus(in context: UIFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
        super.didUpdateFocus(in: context, with: coordinator)
        render()
    }
    #endif
}
