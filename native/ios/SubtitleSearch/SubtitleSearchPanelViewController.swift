//
//  SubtitleSearchPanelViewController.swift
//  TomoTV
//
//  The subtitle panel: on tvOS a glass card over the playing video, on iPhone, iPad and the Mac a
//  sheet. The video's own text tracks lead it as rows with round symbol buttons for their timing,
//  then the language pill and the take-all button, then one search section per video: its query
//  field, a state line and the results as rows. Every string arrives from JS. Below OS 26 the same
//  layout draws on dark blur with filled buttons.
//

import UIKit

private enum Metrics {
    #if os(tvOS)
        static let isTV = true
        static let cardSize = CGSize(width: 1180, height: 760)
        static let cardCornerRadius: CGFloat = 44
        static let rowCornerRadius: CGFloat = 28
        static let controlHeight: CGFloat = 72
        static let margin: CGFloat = 56
        static let titleFont: CGFloat = 40
        static let trackNameFont: CGFloat = 30
        static let metaFont: CGFloat = 22
        static let stateFont: CGFloat = 24
        static let fieldFont: CGFloat = 28
        static let rowTitleFont: CGFloat = 27
        static let rowSubtitleFont: CGFloat = 20
        static let rowSymbol: CGFloat = 44
        static let pillTitleFont: CGFloat = 26
        static let pillSymbol: CGFloat = 20
        static let iconSymbol: CGFloat = 26
        static let pillSideInset: CGFloat = 28
        static let rowInsets = NSDirectionalEdgeInsets(top: 18, leading: 24, bottom: 18, trailing: 24)
        static let sectionSpacing: CGFloat = 22
        static let controlSpacing: CGFloat = 16
    #else
        static let isTV = false
        static let rowCornerRadius: CGFloat = 16
        static let controlHeight: CGFloat = 48
        static let margin: CGFloat = 20
        static let titleFont: CGFloat = 28
        static let trackNameFont: CGFloat = 17
        static let metaFont: CGFloat = 13
        static let stateFont: CGFloat = 14
        static let fieldFont: CGFloat = 16
        static let rowTitleFont: CGFloat = 16
        static let rowSubtitleFont: CGFloat = 12
        static let rowSymbol: CGFloat = 26
        static let pillTitleFont: CGFloat = 15
        static let pillSymbol: CGFloat = 13
        static let iconSymbol: CGFloat = 16
        static let pillSideInset: CGFloat = 16
        static let rowInsets = NSDirectionalEdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14)
        static let sectionSpacing: CGFloat = 14
        static let controlSpacing: CGFloat = 8
    #endif

    static let accent = UIColor(red: 1.0, green: 0.764, blue: 0.07, alpha: 1.0)
    static let dim = UIColor(white: 0.62, alpha: 1)
}

/// Glass on OS 26, dark blur before it, with the same rounded shape.
private func surface(cornerRadius: CGFloat) -> UIVisualEffectView {
    if #available(tvOS 26.0, iOS 26.0, *) {
        let view = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
        view.cornerConfiguration = .corners(radius: .fixed(cornerRadius))
        return view
    }
    let view = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
    view.layer.cornerRadius = cornerRadius
    view.layer.cornerCurve = .continuous
    view.clipsToBounds = true
    return view
}

private func pillConfiguration(prominent: Bool = false) -> UIButton.Configuration {
    var configuration: UIButton.Configuration
    if #available(tvOS 26.0, iOS 26.0, *) {
        configuration = prominent ? .prominentGlass() : .glass()
    } else {
        configuration = prominent ? .filled() : .gray()
    }
    configuration.cornerStyle = .capsule
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: Metrics.pillSideInset, bottom: 0, trailing: Metrics.pillSideInset)
    configuration.imagePadding = Metrics.isTV ? 12 : 8
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: Metrics.pillSymbol, weight: .bold)
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var updated = attributes
        updated.font = UIFont.systemFont(ofSize: Metrics.pillTitleFont, weight: .semibold)
        return updated
    }
    return configuration
}

/// A round button carrying one symbol, the way a player's transport bar draws its actions.
private func roundIconConfiguration(prominent: Bool = false) -> UIButton.Configuration {
    var configuration = pillConfiguration(prominent: prominent)
    configuration.contentInsets = .zero
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: Metrics.iconSymbol, weight: .bold)
    return configuration
}

private func rowConfiguration() -> UIButton.Configuration {
    var configuration: UIButton.Configuration
    if #available(tvOS 26.0, iOS 26.0, *) {
        configuration = .glass()
    } else {
        configuration = .gray()
    }
    configuration.cornerStyle = .fixed
    configuration.background.cornerRadius = Metrics.rowCornerRadius
    configuration.titleAlignment = .leading
    configuration.imagePadding = Metrics.isTV ? 22 : 12
    configuration.titlePadding = 4
    configuration.contentInsets = Metrics.rowInsets
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: Metrics.rowSymbol, weight: .medium)
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var updated = attributes
        updated.font = UIFont.systemFont(ofSize: Metrics.rowTitleFont, weight: .medium)
        return updated
    }
    configuration.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var updated = attributes
        updated.font = UIFont.systemFont(ofSize: Metrics.rowSubtitleFont, weight: .regular)
        updated.foregroundColor = Metrics.dim
        return updated
    }
    return configuration
}

/// The source letter as its SF Symbol square, the captions bubble for a track of the file.
private func monogramImage(_ monogram: String) -> UIImage? {
    (monogram.isEmpty ? nil : UIImage(systemName: "\(monogram.lowercased()).square.fill")) ?? UIImage(systemName: "captions.bubble.fill")
}

// MARK: - Track row

/// One text subtitle the video has: mark, name and meta, then earlier, the offset, later, reset,
/// sync while the video plays, and Replace outside the player.
private final class TrackRowView: UIStackView {
    var onShift: ((Int?) -> Void)?
    var onSync: (() -> Void)?
    var onReplace: (() -> Void)?

    private let icon = UIImageView()
    private let name = UILabel()
    private let meta = UILabel()
    private let earlierButton = UIButton(configuration: roundIconConfiguration())
    private let offsetLabel = UILabel()
    private let laterButton = UIButton(configuration: roundIconConfiguration())
    private let resetButton = UIButton(configuration: roundIconConfiguration())
    private let syncButton = UIButton(configuration: roundIconConfiguration())
    private let replaceButton = UIButton(configuration: roundIconConfiguration())
    private let note = UILabel()

    /// The button focus lands on first when this row leads the panel.
    var leadButton: UIButton { laterButton }

    init() {
        super.init(frame: .zero)
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: Metrics.rowSymbol, weight: .medium)
        icon.tintColor = Metrics.accent
        icon.contentMode = .center
        icon.setContentHuggingPriority(.required, for: .horizontal)
        icon.setContentCompressionResistancePriority(.required, for: .horizontal)

        name.font = UIFont.systemFont(ofSize: Metrics.trackNameFont, weight: .semibold)
        name.textColor = .white
        meta.font = UIFont.systemFont(ofSize: Metrics.metaFont, weight: .regular)
        meta.textColor = Metrics.dim
        let text = UIStackView(arrangedSubviews: [name, meta])
        text.axis = .vertical
        text.spacing = 4
        text.setContentHuggingPriority(.defaultLow, for: .horizontal)
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        earlierButton.configuration?.image = UIImage(systemName: "backward.fill")
        laterButton.configuration?.image = UIImage(systemName: "forward.fill")
        resetButton.configuration?.image = UIImage(systemName: "arrow.counterclockwise")
        syncButton.configuration?.image = UIImage(systemName: "waveform.and.magnifyingglass")
        replaceButton.configuration?.image = UIImage(systemName: "arrow.left.arrow.right")
        for button in [earlierButton, laterButton, resetButton, syncButton, replaceButton] {
            button.setContentHuggingPriority(.required, for: .horizontal)
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
            button.heightAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
            button.widthAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
        }
        earlierButton.addAction(UIAction { [weak self] _ in self?.onShift?(-1) }, for: .primaryActionTriggered)
        laterButton.addAction(UIAction { [weak self] _ in self?.onShift?(1) }, for: .primaryActionTriggered)
        resetButton.addAction(UIAction { [weak self] _ in self?.onShift?(nil) }, for: .primaryActionTriggered)
        syncButton.addAction(UIAction { [weak self] _ in self?.onSync?() }, for: .primaryActionTriggered)
        replaceButton.addAction(UIAction { [weak self] _ in self?.onReplace?() }, for: .primaryActionTriggered)

        offsetLabel.font = UIFont.systemFont(ofSize: Metrics.pillTitleFont, weight: .semibold)
        offsetLabel.textColor = Metrics.accent
        offsetLabel.textAlignment = .center
        offsetLabel.setContentCompressionResistancePriority(.required, for: .horizontal)

        note.font = UIFont.systemFont(ofSize: Metrics.metaFont, weight: .regular)
        note.textColor = Metrics.dim
        note.numberOfLines = 2
        note.isHidden = true

        let controls = UIStackView(arrangedSubviews: [earlierButton, offsetLabel, laterButton, resetButton, syncButton, replaceButton])
        controls.axis = .horizontal
        controls.spacing = Metrics.controlSpacing
        controls.alignment = .center

        let head = UIStackView(arrangedSubviews: [icon, text])
        head.axis = .horizontal
        head.spacing = Metrics.isTV ? 22 : 12
        head.alignment = .center

        // The TV's width takes the whole row on one line; a phone stacks the controls under the name.
        if Metrics.isTV {
            head.addArrangedSubview(controls)
            addArrangedSubview(head)
        } else {
            addArrangedSubview(head)
            addArrangedSubview(controls)
        }
        addArrangedSubview(note)
        axis = .vertical
        spacing = Metrics.isTV ? 10 : 8
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ track: SubtitlePanelTrack) {
        icon.image = monogramImage(track.monogram)
        name.text = track.name
        meta.text = track.meta
        offsetLabel.text = track.offsetLabel
        earlierButton.accessibilityLabel = track.earlierLabel
        laterButton.accessibilityLabel = track.laterLabel
        resetButton.accessibilityLabel = track.resetLabel
        syncButton.accessibilityLabel = track.syncLabel
        syncButton.isHidden = !track.canSync
        syncButton.configuration?.showsActivityIndicator = track.syncing
        syncButton.isEnabled = !track.syncing
        replaceButton.accessibilityLabel = track.replaceLabel
        replaceButton.isHidden = !track.canReplace
        // The armed row's Replace fills in, so the next pick visibly belongs to it.
        replaceButton.configuration = {
            var configuration = roundIconConfiguration(prominent: track.replacing)
            configuration.image = UIImage(systemName: "arrow.left.arrow.right")
            return configuration
        }()
        note.text = track.note
        note.isHidden = track.note.isEmpty
    }
}

// MARK: - Job section

/// One video's search: a header naming it when it is not the whole search, its query field and
/// search button, a state line, a note and the result rows. A header tap folds the body.
private final class JobSectionView: UIStackView, UITextFieldDelegate {
    var onQueryChanged: ((String) -> Void)?
    var onPick: ((String) -> Void)?
    var onToggled: ((Bool) -> Void)?

    private let header = UIButton(configuration: rowConfiguration())
    private let body = UIStackView()
    private let fieldWell = surface(cornerRadius: Metrics.controlHeight / 2)
    private let field = UITextField()
    private let searchButton = UIButton(configuration: roundIconConfiguration(prominent: true))
    private let stateRow = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let stateLabel = UILabel()
    private let noteLabel = UILabel()
    private let resultsStack = UIStackView()
    private var rows: [UIButton] = []
    private var job: SubtitlePanelJob
    private var expanded: Bool

    var fieldEditing: Bool { field.isEditing }
    var leadView: UIView { header.isHidden ? (rows.first ?? field) : header }

    init(job: SubtitlePanelJob, expanded: Bool) {
        self.job = job
        self.expanded = expanded
        super.init(frame: .zero)
        axis = .vertical
        spacing = Metrics.isTV ? 12 : 8

        header.contentHorizontalAlignment = .leading
        header.addAction(UIAction { [weak self] _ in self?.toggle() }, for: .primaryActionTriggered)

        field.borderStyle = .none
        field.font = UIFont.systemFont(ofSize: Metrics.fieldFont, weight: .medium)
        field.textColor = .white
        field.returnKeyType = .search
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.delegate = self
        // The field fills the well and clips to the same capsule, so the background it draws itself takes the well's shape; the text keeps its side room through the side views.
        field.layer.cornerRadius = Metrics.controlHeight / 2
        field.layer.cornerCurve = .continuous
        field.clipsToBounds = true
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: Metrics.pillSideInset, height: 1))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: Metrics.pillSideInset, height: 1))
        field.rightViewMode = .always
        field.translatesAutoresizingMaskIntoConstraints = false
        fieldWell.contentView.addSubview(field)
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: fieldWell.contentView.leadingAnchor),
            field.trailingAnchor.constraint(equalTo: fieldWell.contentView.trailingAnchor),
            field.topAnchor.constraint(equalTo: fieldWell.contentView.topAnchor),
            field.bottomAnchor.constraint(equalTo: fieldWell.contentView.bottomAnchor),
        ])
        fieldWell.setContentHuggingPriority(.defaultLow, for: .horizontal)

        searchButton.configuration?.image = UIImage(systemName: "magnifyingglass")
        searchButton.widthAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
        searchButton.setContentHuggingPriority(.required, for: .horizontal)
        searchButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        searchButton.addAction(UIAction { [weak self] _ in self?.searchPressed() }, for: .primaryActionTriggered)

        let controls = UIStackView(arrangedSubviews: [fieldWell, searchButton])
        controls.axis = .horizontal
        controls.spacing = Metrics.controlSpacing
        controls.alignment = .fill
        controls.heightAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true

        spinner.color = Metrics.accent
        spinner.hidesWhenStopped = true
        stateLabel.font = UIFont.systemFont(ofSize: Metrics.stateFont, weight: .semibold)
        stateLabel.textColor = Metrics.dim
        stateRow.addArrangedSubview(spinner)
        stateRow.addArrangedSubview(stateLabel)
        stateRow.axis = .horizontal
        stateRow.spacing = Metrics.isTV ? 12 : 8
        stateRow.alignment = .center

        noteLabel.font = UIFont.systemFont(ofSize: Metrics.metaFont, weight: .regular)
        noteLabel.textColor = Metrics.dim
        noteLabel.numberOfLines = 2

        resultsStack.axis = .vertical
        resultsStack.spacing = Metrics.isTV ? 10 : 6

        for view in [controls, stateRow, noteLabel, resultsStack] { body.addArrangedSubview(view) }
        body.axis = .vertical
        body.spacing = Metrics.isTV ? 12 : 8

        addArrangedSubview(header)
        addArrangedSubview(body)
        apply(job, force: true)
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func toggle() {
        expanded.toggle()
        body.isHidden = !expanded
        var configuration = header.configuration
        configuration?.image = UIImage(systemName: expanded ? "chevron.up" : "chevron.down")
        header.configuration = configuration
        onToggled?(expanded)
    }

    private func searchPressed() {
        field.resignFirstResponder()
        let query = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        onQueryChanged?(query)
    }

    func apply(_ next: SubtitlePanelJob, force: Bool = false) {
        let previous = job
        job = next
        // A lone job is the whole search: no header, the body always open, the state on its own line.
        let alone = next.heading.isEmpty
        header.isHidden = alone
        body.isHidden = !(alone || expanded)
        if !alone {
            var configuration = header.configuration ?? rowConfiguration()
            configuration.attributedTitle = Self.headerTitle(label: next.label, heading: next.heading)
            configuration.subtitle = next.stateLine
            configuration.image = UIImage(systemName: expanded ? "chevron.up" : "chevron.down")
            configuration.imagePlacement = .trailing
            configuration.showsActivityIndicator = next.busy
            header.configuration = configuration
        }
        stateRow.isHidden = !alone
        stateLabel.text = next.stateLine
        if alone && next.busy { spinner.startAnimating() } else { spinner.stopAnimating() }
        if !field.isEditing, field.text != next.query { field.text = next.query }
        noteLabel.text = next.note
        noteLabel.isHidden = next.note.isEmpty
        if force || previous.results.count != next.results.count {
            rebuildRows()
        } else {
            for index in next.results.indices where next.results[index] != previous.results[index] {
                configure(rows[index], with: next.results[index])
            }
        }
    }

    func applyShared(placeholder: String, searchLabel: String) {
        field.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor(white: 0.5, alpha: 1)])
        searchButton.accessibilityLabel = searchLabel
    }

    private static func headerTitle(label: String, heading: String) -> AttributedString {
        var title = AttributedString(label.isEmpty ? heading : "\(label)  \(heading)")
        if !label.isEmpty, let range = title.range(of: label) {
            title[range].foregroundColor = Metrics.accent
        }
        return title
    }

    private func rebuildRows() {
        rows.forEach { $0.removeFromSuperview() }
        rows = job.results.enumerated().map { position, result in
            let button = UIButton(configuration: rowConfiguration())
            button.contentHorizontalAlignment = .leading
            configure(button, with: result)
            button.addAction(
                UIAction { [weak self] _ in
                    guard let self, position < self.job.results.count else { return }
                    let current = self.job.results[position]
                    guard !current.applying, !current.applied else { return }
                    self.onPick?(current.id)
                }, for: .primaryActionTriggered
            )
            return button
        }
        rows.forEach(resultsStack.addArrangedSubview)
    }

    /// The source mark leads the row; a saved row shows the tick instead.
    private func configure(_ button: UIButton, with result: SubtitlePanelResult) {
        var configuration = button.configuration ?? rowConfiguration()
        configuration.image = result.applied ? UIImage(systemName: "checkmark.circle.fill") : monogramImage(result.monogram)
        configuration.imageColorTransformer = result.hashMatch || result.applied ? UIConfigurationColorTransformer { _ in Metrics.accent } : nil
        configuration.showsActivityIndicator = result.applying
        configuration.title = result.name
        let badges = result.badges.joined(separator: "  ")
        configuration.subtitle = badges.isEmpty ? result.meta : "\(badges)  ·  \(result.meta)"
        button.configuration = configuration
        button.alpha = result.applied ? 0.7 : 1
    }

    // MARK: - UITextFieldDelegate

    func textFieldDidEndEditing(_ textField: UITextField) {
        let query = (textField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, query != job.query else { return }
        onQueryChanged?(query)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }
}

// MARK: - Panel

final class SubtitleSearchPanelViewController: UIViewController {
    var onQueryChanged: ((String, String) -> Void)?
    var onLanguageChanged: ((String) -> Void)?
    var onPick: ((String, String) -> Void)?
    /// A timing press: the track's stream index and the step's sign, or nil for the reset.
    var onShift: ((Int, Int?) -> Void)?
    var onSync: ((Int) -> Void)?
    var onReplace: ((Int) -> Void)?
    var onTakeAll: (() -> Void)?
    var onDismissed: (() -> Void)?

    private var state: SubtitlePanelState
    private var quiet = false

    private let scroll = UIScrollView()
    private let contentStack = UIStackView()
    private let titleLabel = UILabel()
    private let tracksStack = UIStackView()
    private var trackRows: [TrackRowView] = []
    private let languageButton = UIButton(configuration: pillConfiguration())
    private let takeAllButton = UIButton(configuration: pillConfiguration(prominent: true))
    private let skippedLabel = UILabel()
    private let emptyLabel = UILabel()
    private let jobsStack = UIStackView()
    private var jobSections: [JobSectionView] = []
    /// Fold state per item id, kept while the job list is rebuilt around it.
    private var expandedJobs: [String: Bool] = [:]

    init(state: SubtitlePanelState) {
        self.state = state
        super.init(nibName: nil, bundle: nil)
        overrideUserInterfaceStyle = .dark
        #if os(tvOS)
            modalPresentationStyle = .overFullScreen
            modalTransitionStyle = .crossDissolve
        #else
            modalPresentationStyle = .pageSheet
            sheetPresentationController?.detents = [.large()]
            sheetPresentationController?.prefersGrabberVisible = true
        #endif
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildLayout()
        apply(state, force: true)
    }

    /// Gone from the screen for any reason but a quiet close: Menu, the sheet pulled down, or the
    /// player under it being replaced.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard !quiet, isBeingDismissed || view.window == nil, let report = onDismissed else { return }
        onDismissed = nil
        report()
    }

    #if os(tvOS)
        override var preferredFocusEnvironments: [UIFocusEnvironment] {
            if let lead = trackRows.first?.leadButton { return [lead] }
            if let lead = jobSections.first?.leadView { return [lead] }
            return []
        }
    #endif

    // MARK: - Layout

    private func buildLayout() {
        let content: UIView
        #if os(tvOS)
            view.backgroundColor = UIColor.black.withAlphaComponent(0.35)
            let card = surface(cornerRadius: Metrics.cardCornerRadius)
            card.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(card)
            NSLayoutConstraint.activate([
                card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                card.widthAnchor.constraint(equalToConstant: Metrics.cardSize.width),
                card.heightAnchor.constraint(equalToConstant: Metrics.cardSize.height),
            ])
            content = card.contentView
        #else
            view.backgroundColor = UIColor(white: 0.08, alpha: 1)
            content = view
        #endif

        scroll.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: content.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
        ])
        #if os(tvOS)
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor).isActive = true
        #else
            // The keyboard lifts the content instead of covering the field being typed in.
            scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor).isActive = true
            scroll.keyboardDismissMode = .onDrag
        #endif

        titleLabel.font = UIFont.systemFont(ofSize: Metrics.titleFont, weight: .bold)
        titleLabel.textColor = .white

        tracksStack.axis = .vertical
        tracksStack.spacing = Metrics.isTV ? 18 : 14

        languageButton.configuration?.image = UIImage(systemName: "chevron.down")
        languageButton.configuration?.imagePlacement = .trailing
        languageButton.setContentHuggingPriority(.required, for: .horizontal)
        languageButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        if #available(tvOS 17.0, iOS 14.0, *) {
            languageButton.showsMenuAsPrimaryAction = true
        } else {
            languageButton.addTarget(self, action: #selector(nextLanguage), for: .primaryActionTriggered)
        }
        languageButton.heightAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true

        takeAllButton.addAction(UIAction { [weak self] _ in self?.onTakeAll?() }, for: .primaryActionTriggered)
        takeAllButton.heightAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
        takeAllButton.setContentHuggingPriority(.required, for: .horizontal)

        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let pills = UIStackView(arrangedSubviews: [languageButton, spacer, takeAllButton])
        pills.axis = .horizontal
        pills.spacing = Metrics.controlSpacing
        pills.alignment = .center

        skippedLabel.font = UIFont.systemFont(ofSize: Metrics.metaFont, weight: .regular)
        skippedLabel.textColor = Metrics.dim
        skippedLabel.numberOfLines = 2
        emptyLabel.font = UIFont.systemFont(ofSize: Metrics.stateFont, weight: .regular)
        emptyLabel.textColor = Metrics.dim
        emptyLabel.textAlignment = .center

        jobsStack.axis = .vertical
        jobsStack.spacing = Metrics.sectionSpacing

        for view in [titleLabel, tracksStack, pills, skippedLabel, emptyLabel, jobsStack] { contentStack.addArrangedSubview(view) }
        contentStack.axis = .vertical
        contentStack.spacing = Metrics.sectionSpacing
        contentStack.setCustomSpacing(Metrics.isTV ? 28 : 18, after: titleLabel)
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(contentStack)
        let top: CGFloat = Metrics.isTV ? 48 : 24
        NSLayoutConstraint.activate([
            contentStack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: top),
            contentStack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -Metrics.margin),
            contentStack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: Metrics.margin),
            contentStack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -Metrics.margin),
            contentStack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -2 * Metrics.margin),
        ])
    }

    // MARK: - Actions

    /// Before tvOS 17 a button has no menu: a press moves to the next language in the list.
    @objc private func nextLanguage() {
        guard !state.languages.isEmpty else { return }
        let next = state.languages[(state.selectedLanguageIndex + 1) % state.languages.count]
        onLanguageChanged?(next.code)
    }

    private func languageMenu() -> UIMenu {
        UIMenu(
            options: [.singleSelection],
            children: state.languages.map { language in
                UIAction(title: language.name, state: language.code == state.selectedLanguage ? .on : .off) { [weak self] _ in
                    guard let self, language.code != self.state.selectedLanguage else { return }
                    self.onLanguageChanged?(language.code)
                }
            }
        )
    }

    // MARK: - State

    func apply(_ next: SubtitlePanelState) {
        apply(next, force: false)
    }

    private func apply(_ next: SubtitlePanelState, force: Bool) {
        let previous = state
        state = next
        guard isViewLoaded else { return }
        titleLabel.text = next.title

        if force || previous.tracks.count != next.tracks.count { rebuildTrackRows() }
        for (index, track) in next.tracks.enumerated() where index < trackRows.count { trackRows[index].configure(track) }
        tracksStack.isHidden = next.tracks.isEmpty

        languageButton.configuration?.title = next.languages.indices.contains(next.selectedLanguageIndex) ? next.languages[next.selectedLanguageIndex].name : next.selectedLanguage
        if #available(tvOS 17.0, iOS 14.0, *) {
            languageButton.menu = languageMenu()
        }
        takeAllButton.isHidden = next.takeAll == nil
        if let takeAll = next.takeAll {
            takeAllButton.configuration?.title = takeAll.label
            takeAllButton.configuration?.showsActivityIndicator = takeAll.busy
            takeAllButton.isEnabled = !takeAll.busy
        }
        skippedLabel.text = next.skippedLine
        skippedLabel.isHidden = next.skippedLine.isEmpty
        emptyLabel.text = next.emptyLine
        emptyLabel.isHidden = next.emptyLine.isEmpty

        if force || previous.jobs.map(\.id) != next.jobs.map(\.id) {
            rebuildJobSections()
        } else {
            for (index, job) in next.jobs.enumerated() where index < jobSections.count { jobSections[index].apply(job) }
        }
        for section in jobSections { section.applyShared(placeholder: next.queryPlaceholder, searchLabel: next.searchLabel) }
        restoreFocusIfLost()
    }

    private func rebuildTrackRows() {
        trackRows.forEach { $0.removeFromSuperview() }
        trackRows = state.tracks.map { track in
            let row = TrackRowView()
            row.onShift = { [weak self] delta in self?.onShift?(track.id, delta) }
            row.onSync = { [weak self] in self?.onSync?(track.id) }
            row.onReplace = { [weak self] in self?.onReplace?(track.id) }
            return row
        }
        trackRows.forEach(tracksStack.addArrangedSubview)
    }

    private func rebuildJobSections() {
        jobSections.forEach { $0.removeFromSuperview() }
        jobSections = state.jobs.map { job in
            let section = JobSectionView(job: job, expanded: expandedJobs[job.id] ?? false)
            section.onQueryChanged = { [weak self] query in self?.onQueryChanged?(job.id, query) }
            section.onPick = { [weak self] id in self?.onPick?(job.id, id) }
            section.onToggled = { [weak self] expanded in self?.expandedJobs[job.id] = expanded }
            return section
        }
        jobSections.forEach(jobsStack.addArrangedSubview)
        #if os(tvOS)
            setNeedsFocusUpdate()
        #endif
    }

    private func restoreFocusIfLost() {
        #if os(tvOS)
            guard viewIfLoaded?.window != nil, !jobSections.contains(where: \.fieldEditing) else { return }
            if let focused = UIFocusSystem.focusSystem(for: self)?.focusedItem as? UIView, focused.isDescendant(of: view) { return }
            setNeedsFocusUpdate()
            updateFocusIfNeeded()
        #endif
    }

    // MARK: - Dismissal

    #if os(tvOS)
        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            if presses.contains(where: { $0.type == .menu }) {
                dismiss(animated: true)
                return
            }
            super.pressesBegan(presses, with: event)
        }
    #endif

    /// A dismissal JS asked for: no dismissed event goes back.
    func closeQuietly(completion: @escaping () -> Void) {
        quiet = true
        dismiss(animated: true, completion: completion)
    }
}
