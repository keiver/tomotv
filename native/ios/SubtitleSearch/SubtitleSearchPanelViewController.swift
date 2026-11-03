//
//  SubtitleSearchPanelViewController.swift
//  TomoTV
//
//  The subtitle panel: on tvOS a glass card over the playing video, on iPhone, iPad and the Mac a
//  sheet. The language pill and the take-all button lead it, then one search section per video: its
//  query field, a state line and the results as rows, the kept pick's row with its timing controls
//  under it. Every string arrives from JS. Below OS 26 the same layout draws on dark blur with filled buttons.
//

import UIKit

private enum Metrics {
    #if os(tvOS)
        static let isTV = true
        static let cardSize = CGSize(width: 1180, height: 700)
        static let cardCornerRadius: CGFloat = 44
        static let rowCornerRadius: CGFloat = 28
        static let controlHeight: CGFloat = 72
        static let margin: CGFloat = 56
        static let titleFont: CGFloat = 40
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
        static let sectionSpacing: CGFloat = 30
        static let controlSpacing: CGFloat = 16
    #else
        static let isTV = false
        static let rowCornerRadius: CGFloat = 16
        static let controlHeight: CGFloat = 48
        static let margin: CGFloat = 20
        static let titleFont: CGFloat = 28
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
        static let sectionSpacing: CGFloat = 18
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

// MARK: - Track row

/// The timing controls under a kept pick's result row: earlier, the offset, later, reset, and sync while the video plays.
private final class TrackRowView: UIStackView {
    var onShift: ((Int?) -> Void)?
    var onSync: (() -> Void)?
    /// A match is running: the sync button spins and ignores presses, but stays enabled so focus keeps its normal look.
    private var syncing = false

    private let earlierButton = UIButton(configuration: pillConfiguration())
    private let offsetLabel = UILabel()
    private let laterButton = UIButton(configuration: pillConfiguration())
    private let resetButton = UIButton(configuration: roundIconConfiguration())
    private let syncButton = UIButton(configuration: pillConfiguration(prominent: true))
    private let note = UILabel()

    init() {
        super.init(frame: .zero)
        resetButton.configuration?.image = UIImage(systemName: "arrow.counterclockwise")
        syncButton.configuration?.image = UIImage(systemName: "waveform.and.magnifyingglass")
        // The step buttons and the sync button carry words, so they are pills sized by their text.
        for button in [earlierButton, laterButton, syncButton] {
            button.setContentHuggingPriority(.required, for: .horizontal)
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
            button.heightAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
        }
        for button in [resetButton] {
            button.setContentHuggingPriority(.required, for: .horizontal)
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
            button.heightAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
            button.widthAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
        }
        earlierButton.addAction(UIAction { [weak self] _ in self?.onShift?(-1) }, for: .primaryActionTriggered)
        laterButton.addAction(UIAction { [weak self] _ in self?.onShift?(1) }, for: .primaryActionTriggered)
        resetButton.addAction(UIAction { [weak self] _ in self?.onShift?(nil) }, for: .primaryActionTriggered)
        syncButton.addAction(
            UIAction { [weak self] _ in
                guard let self, !self.syncing else { return }
                self.onSync?()
            }, for: .primaryActionTriggered)

        offsetLabel.font = UIFont.systemFont(ofSize: Metrics.pillTitleFont, weight: .semibold)
        offsetLabel.textColor = Metrics.accent
        offsetLabel.textAlignment = .center
        offsetLabel.setContentCompressionResistancePriority(.required, for: .horizontal)

        note.font = UIFont.systemFont(ofSize: Metrics.metaFont, weight: .regular)
        note.textColor = Metrics.dim
        note.numberOfLines = 0
        note.setContentCompressionResistancePriority(.required, for: .vertical)
        note.isHidden = true

        let controls = UIStackView(arrangedSubviews: [earlierButton, offsetLabel, laterButton, resetButton])
        controls.axis = .horizontal
        controls.spacing = Metrics.controlSpacing
        controls.alignment = .center

        // The TV's width takes the whole row on one line; a phone puts the sync button under the controls.
        if Metrics.isTV { controls.addArrangedSubview(syncButton) }
        let line = UIStackView(arrangedSubviews: [controls, UIView()])
        line.axis = .horizontal
        addArrangedSubview(line)
        if !Metrics.isTV {
            addArrangedSubview(syncButton)
        }
        addArrangedSubview(note)
        axis = .vertical
        spacing = Metrics.isTV ? 16 : 10
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ track: SubtitlePanelTrack, accent: UIColor) {
        offsetLabel.textColor = accent
        offsetLabel.text = track.offsetLabel
        earlierButton.configuration?.title = track.earlierTitle
        laterButton.configuration?.title = track.laterTitle
        earlierButton.accessibilityLabel = track.earlierLabel
        laterButton.accessibilityLabel = track.laterLabel
        resetButton.accessibilityLabel = track.resetLabel
        syncButton.configuration?.title = track.syncLabel
        syncButton.isHidden = !track.canSync
        syncing = track.syncing
        syncButton.configuration?.showsActivityIndicator = track.syncing
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
    /// A timing press under the playing pick's row: its stream index and the step's sign, or nil for the reset.
    var onShift: ((Int, Int?) -> Void)?
    var onSync: ((Int) -> Void)?

    private let header = UIButton(configuration: rowConfiguration())
    private let body = UIStackView()
    private let fieldWell = surface(cornerRadius: Metrics.controlHeight / 2)
    private let field = UITextField()
    private let searchButton = UIButton(type: .custom)
    private let controls = UIStackView()
    private let stateRow = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let stateLabel = UILabel()
    private let noteLabel = UILabel()
    private let resultsStack = UIStackView()
    private var rows: [UIButton] = []
    /// The timing controls under a result row, by the row's position.
    private var timingRows: [Int: TrackRowView] = [:]
    private var accent = Metrics.accent
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

        let glass = UIImage(systemName: "magnifyingglass", withConfiguration: UIImage.SymbolConfiguration(pointSize: Metrics.iconSymbol, weight: .bold))?.withRenderingMode(.alwaysTemplate)
        searchButton.setImage(glass, for: .normal)
        searchButton.tintColor = Metrics.accent
        searchButton.widthAnchor.constraint(equalToConstant: Metrics.controlHeight).isActive = true
        searchButton.setContentHuggingPriority(.required, for: .horizontal)
        searchButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        searchButton.addAction(UIAction { [weak self] _ in self?.searchPressed() }, for: .primaryActionTriggered)

        controls.addArrangedSubview(fieldWell)
        controls.addArrangedSubview(searchButton)
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
        noteLabel.numberOfLines = 0
        noteLabel.setContentCompressionResistancePriority(.required, for: .vertical)
        stateLabel.setContentCompressionResistancePriority(.required, for: .vertical)

        resultsStack.axis = .vertical
        resultsStack.spacing = Metrics.isTV ? 14 : 8

        for view in [controls, stateRow, noteLabel, resultsStack] { body.addArrangedSubview(view) }
        body.axis = .vertical
        body.spacing = Metrics.isTV ? 20 : 12

        addArrangedSubview(header)
        addArrangedSubview(body)
        apply(job, force: true)
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    #if os(tvOS)
        override func didUpdateFocus(in context: UIFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
            super.didUpdateFocus(in: context, with: coordinator)
            coordinator.addCoordinatedAnimations { [searchButton] in
                searchButton.transform = context.nextFocusedView === searchButton ? CGAffineTransform(scaleX: 1.2, y: 1.2) : .identity
            }
        }
    #endif

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
        stateRow.isHidden = !alone || next.results.isEmpty
        stateLabel.text = next.stateLine
        if alone && next.busy { spinner.startAnimating() } else { spinner.stopAnimating() }
        if !field.isEditing, field.text != next.query { field.text = next.query }
        noteLabel.text = next.note
        noteLabel.isHidden = next.note.isEmpty
        if force || previous.results.count != next.results.count || previous.results.map({ $0.timing == nil }) != next.results.map({ $0.timing == nil }) {
            rebuildRows()
        } else {
            for index in next.results.indices where next.results[index] != previous.results[index] {
                configure(rows[index], with: next.results[index])
                if let timing = next.results[index].timing { timingRows[index]?.configure(timing, accent: accent) }
            }
        }
    }

    /// Puts a control at the front of the field's row: the language button of a lone search.
    func lead(with view: UIView) {
        guard view.superview !== controls else { return }
        controls.insertArrangedSubview(view, at: 0)
    }

    func applyShared(placeholder: String, searchLabel: String, accent: UIColor) {
        field.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor(white: 0.5, alpha: 1)])
        searchButton.accessibilityLabel = searchLabel
        searchButton.tintColor = accent
        guard accent != self.accent else { return }
        self.accent = accent
        for (position, row) in timingRows {
            if let timing = job.results[position].timing { row.configure(timing, accent: accent) }
        }
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
        timingRows.values.forEach { $0.removeFromSuperview() }
        timingRows = [:]
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
        for (position, row) in rows.enumerated() {
            resultsStack.addArrangedSubview(row)
            guard let timing = job.results[position].timing else { continue }
            let controls = TrackRowView()
            controls.configure(timing, accent: accent)
            controls.onShift = { [weak self] delta in
                guard let self, position < self.job.results.count, let id = self.job.results[position].timing?.id else { return }
                self.onShift?(id, delta)
            }
            controls.onSync = { [weak self] in
                guard let self, position < self.job.results.count, let id = self.job.results[position].timing?.id else { return }
                self.onSync?(id)
            }
            timingRows[position] = controls
            resultsStack.addArrangedSubview(controls)
        }
    }

    /// The name over its downloads and the rest of its meta, then its badges; a saved row leads with the tick.
    private func configure(_ button: UIButton, with result: SubtitlePanelResult) {
        var configuration = button.configuration ?? rowConfiguration()
        configuration.image = result.applied ? UIImage(systemName: "checkmark.circle.fill") : nil
        configuration.imageColorTransformer = result.applied ? UIConfigurationColorTransformer { _ in Metrics.accent } : nil
        configuration.showsActivityIndicator = result.applying
        configuration.title = result.name
        let badges = result.badges.joined(separator: "  ")
        configuration.subtitle = badges.isEmpty ? result.meta : "\(result.meta)  ·  \(badges)"
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
    var onTakeAll: (() -> Void)?
    var onDismissed: (() -> Void)?

    private var state: SubtitlePanelState
    private var quiet = false

    private let scroll = UIScrollView()
    private let contentStack = UIStackView()
    private let titleLabel = UILabel()
    private let creditLabel = UILabel()
    private let languageButton = UIButton(configuration: pillConfiguration())
    private let takeAllButton = UIButton(configuration: pillConfiguration(prominent: true))
    private let skippedLabel = UILabel()
    private let emptyLabel = UILabel()
    private let jobsStack = UIStackView()
    private var jobSections: [JobSectionView] = []
    /// Fold state per item id, kept while the job list is rebuilt around it.
    private var expandedJobs: [String: Bool] = [:]
    private let pills = UIStackView()
    private let centerState = UIStackView()
    private let centerSpinner = UIActivityIndicatorView(style: .medium)
    private let centerLabel = UILabel()
    /// Active only while the state shows: at its priority it ties the result rows' compression resistance and squashes them to the screen.
    private var centerStateCentered: NSLayoutConstraint?
    #if !os(tvOS)
        private let closeButton = UIButton(configuration: roundIconConfiguration())
        /// The responder that held the keys before the sheet took them, handed back as it leaves.
        private weak var previousResponder: UIResponder?
    #endif

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
        scroll.topAnchor.constraint(equalTo: content.topAnchor).isActive = true
        #if os(tvOS)
            NSLayoutConstraint.activate([
                scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
                scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
                scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            ])
        #else
            NSLayoutConstraint.activate([
                scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
                scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            ])
            // The keyboard lifts the content instead of covering the field being typed in.
            scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor).isActive = true
            scroll.keyboardDismissMode = .onDrag
        #endif

        titleLabel.font = UIFont.systemFont(ofSize: Metrics.titleFont, weight: .bold)
        titleLabel.textColor = .white
        titleLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
        creditLabel.font = UIFont.systemFont(ofSize: Metrics.metaFont, weight: .regular)
        creditLabel.textColor = Metrics.dim
        creditLabel.numberOfLines = 2
        // The TV's width keeps the credit beside the title; a phone puts it under the title.
        let titleRow = UIStackView(arrangedSubviews: [titleLabel, creditLabel])
        titleRow.axis = Metrics.isTV ? .horizontal : .vertical
        titleRow.spacing = Metrics.isTV ? Metrics.controlSpacing : 2
        titleRow.alignment = Metrics.isTV ? .firstBaseline : .leading
        #if !os(tvOS)
            titleRow.isLayoutMarginsRelativeArrangement = true
            titleRow.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: Metrics.controlHeight + Metrics.controlSpacing)
        #endif

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
        for view in [languageButton, spacer, takeAllButton] { pills.addArrangedSubview(view) }
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

        for view in [titleRow, pills, skippedLabel, emptyLabel, jobsStack] { contentStack.addArrangedSubview(view) }
        contentStack.axis = .vertical
        contentStack.spacing = Metrics.sectionSpacing
        contentStack.setCustomSpacing(Metrics.isTV ? 28 : 18, after: titleRow)
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

        centerSpinner.color = Metrics.accent
        centerSpinner.hidesWhenStopped = true
        centerLabel.font = UIFont.systemFont(ofSize: Metrics.stateFont, weight: .semibold)
        centerLabel.textColor = Metrics.dim
        centerLabel.textAlignment = .center
        centerLabel.numberOfLines = 0
        centerState.addArrangedSubview(centerSpinner)
        centerState.addArrangedSubview(centerLabel)
        centerState.axis = .vertical
        centerState.alignment = .center
        centerState.spacing = Metrics.isTV ? 16 : 10
        centerState.isHidden = true
        centerState.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(centerState)
        let resultsArea = UILayoutGuide()
        scroll.addLayoutGuide(resultsArea)
        let centered = centerState.centerYAnchor.constraint(equalTo: resultsArea.centerYAnchor)
        centered.priority = .defaultHigh
        centerStateCentered = centered
        NSLayoutConstraint.activate([
            resultsArea.topAnchor.constraint(equalTo: contentStack.bottomAnchor),
            resultsArea.bottomAnchor.constraint(equalTo: scroll.frameLayoutGuide.bottomAnchor),
            centerState.topAnchor.constraint(greaterThanOrEqualTo: contentStack.bottomAnchor, constant: Metrics.sectionSpacing),
            centerState.centerXAnchor.constraint(equalTo: scroll.frameLayoutGuide.centerXAnchor),
            centerState.widthAnchor.constraint(lessThanOrEqualTo: scroll.frameLayoutGuide.widthAnchor, constant: -2 * Metrics.margin),
        ])

        #if !os(tvOS)
            closeButton.configuration?.image = UIImage(systemName: "xmark")
            closeButton.addAction(UIAction { [weak self] _ in self?.dismiss(animated: true) }, for: .primaryActionTriggered)
            closeButton.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(closeButton)
            NSLayoutConstraint.activate([
                closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
                closeButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -Metrics.margin),
                closeButton.widthAnchor.constraint(equalToConstant: Metrics.controlHeight),
                closeButton.heightAnchor.constraint(equalToConstant: Metrics.controlHeight),
            ])
        #endif
    }

    // MARK: - Actions

    /// Before tvOS 17 a button has no menu: a press moves to the next language in the list.
    @objc private func nextLanguage() {
        guard !state.languages.isEmpty else { return }
        let next = state.languages[(state.selectedLanguageIndex + 1) % state.languages.count]
        onLanguageChanged?(next.code)
    }

    /// A result press asks first: the result's name and the downloads left today, then Download or Cancel.
    private func confirmPick(jobId: String, resultId: String) {
        guard let confirm = state.confirm else {
            onPick?(jobId, resultId)
            return
        }
        let name = state.jobs.first(where: { $0.id == jobId })?.results.first(where: { $0.id == resultId })?.name ?? ""
        let message = [name, confirm.remaining].filter { !$0.isEmpty }.joined(separator: "\n\n")
        let alert = UIAlertController(title: confirm.title, message: message.isEmpty ? nil : message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: confirm.cancel, style: .cancel))
        let download = UIAlertAction(title: confirm.download, style: .default) { [weak self] _ in self?.onPick?(jobId, resultId) }
        alert.addAction(download)
        alert.preferredAction = download
        present(alert, animated: true)
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
        creditLabel.text = next.credit
        #if !os(tvOS)
            closeButton.accessibilityLabel = next.closeLabel
        #endif

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
        for section in jobSections { section.applyShared(placeholder: next.queryPlaceholder, searchLabel: next.searchLabel, accent: accentColor) }
        let loneSection = next.jobs.count == 1 && next.jobs[0].heading.isEmpty ? jobSections.first : nil
        if let loneSection {
            loneSection.lead(with: languageButton)
        } else if languageButton.superview !== pills {
            pills.insertArrangedSubview(languageButton, at: 0)
        }
        pills.isHidden = loneSection != nil && next.takeAll == nil
        let waiting = loneSection != nil && next.jobs[0].results.isEmpty ? next.jobs[0] : nil
        centerState.isHidden = waiting == nil
        centerStateCentered?.isActive = waiting != nil
        centerLabel.text = waiting?.stateLine
        if waiting?.busy == true { centerSpinner.startAnimating() } else { centerSpinner.stopAnimating() }
        restoreFocusIfLost()
    }

    /// The viewer's theme colour, the gold when the state carries none.
    private var accentColor: UIColor {
        guard let rgb = state.accentComponents else { return Metrics.accent }
        return UIColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
    }

    private func rebuildJobSections() {
        jobSections.forEach { $0.removeFromSuperview() }
        jobSections = state.jobs.map { job in
            let section = JobSectionView(job: job, expanded: expandedJobs[job.id] ?? false)
            section.onQueryChanged = { [weak self] query in self?.onQueryChanged?(job.id, query) }
            section.onPick = { [weak self] id in self?.confirmPick(jobId: job.id, resultId: id) }
            section.onToggled = { [weak self] expanded in self?.expandedJobs[job.id] = expanded }
            section.onShift = { [weak self] id, delta in self?.onShift?(id, delta) }
            section.onSync = { [weak self] id in self?.onSync?(id) }
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
    #else
        override var canBecomeFirstResponder: Bool { true }

        override var keyCommands: [UIKeyCommand]? {
            let escape = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(escapePressed))
            escape.wantsPriorityOverSystemBehavior = true
            return [escape]
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            previousResponder = view.window?.rootViewController
            becomeFirstResponder()
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            guard isBeingDismissed, let previous = previousResponder, previous.canBecomeFirstResponder else { return }
            previous.becomeFirstResponder()
        }

        /// The first Escape leaves the query field, the next one closes the sheet.
        @objc private func escapePressed() {
            if jobSections.contains(where: \.fieldEditing) {
                view.endEditing(true)
                becomeFirstResponder()
                return
            }
            dismiss(animated: true)
        }
    #endif

    /// A dismissal JS asked for: no dismissed event goes back.
    func closeQuietly(completion: @escaping () -> Void) {
        quiet = true
        dismiss(animated: true, completion: completion)
    }
}
