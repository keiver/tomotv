//
//  SubtitleSearchPanelViewController.swift
//  TomoTV
//
//  The tvOS subtitle panel: a glass card over the playing video with one row of controls
//  (language, search text, search), a state line and the results as glass buttons. Every string
//  arrives from JS. Below tvOS 26 the same layout draws on dark blur with filled buttons.
//

#if os(tvOS)

    import UIKit

    final class SubtitleSearchPanelViewController: UIViewController, UITextFieldDelegate {
        var onQueryChanged: ((String) -> Void)?
        var onLanguageChanged: ((String) -> Void)?
        var onPick: ((String) -> Void)?
        /// A timing press: the step's sign in milliseconds, or nil for the reset.
        var onShift: ((Int?) -> Void)?
        var onDismissed: (() -> Void)?

        private var state: SubtitlePanelState
        private var quiet = false

        private let card = SubtitleSearchPanelViewController.surface(cornerRadius: 44)
        private let titleLabel = UILabel()
        private let currentRow = UIStackView()
        private let currentName = UILabel()
        private let currentMeta = UILabel()
        private let earlierButton = UIButton(configuration: SubtitleSearchPanelViewController.pill())
        private let offsetLabel = UILabel()
        private let laterButton = UIButton(configuration: SubtitleSearchPanelViewController.pill())
        private let resetButton = UIButton(configuration: SubtitleSearchPanelViewController.pill())
        private let languageButton = UIButton(configuration: SubtitleSearchPanelViewController.pill())
        private let fieldWell = SubtitleSearchPanelViewController.surface(cornerRadius: 36)
        private let field = UITextField()
        private let searchButton = UIButton(configuration: SubtitleSearchPanelViewController.pill(prominent: true))
        private let stateLabel = UILabel()
        private let noteLabel = UILabel()
        private let spinner = UIActivityIndicatorView(style: .large)
        private let resultsScroll = UIScrollView()
        private let resultsStack = UIStackView()
        private var rows: [UIButton] = []

        private static let accent = UIColor(red: 1.0, green: 0.764, blue: 0.07, alpha: 1.0)
        private static let dim = UIColor(white: 0.62, alpha: 1)
        private static let cardSize = CGSize(width: 1180, height: 760)
        private static let controlHeight: CGFloat = 72
        private static let margin: CGFloat = 56
        private static let rowCornerRadius: CGFloat = 28

        init(state: SubtitlePanelState) {
            self.state = state
            super.init(nibName: nil, bundle: nil)
            modalPresentationStyle = .overFullScreen
            modalTransitionStyle = .crossDissolve
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = UIColor.black.withAlphaComponent(0.35)
            buildCard()
            apply(state, force: true)
        }

        override var preferredFocusEnvironments: [UIFocusEnvironment] {
            if state.current != nil { return [laterButton] }
            if let first = rows.first { return [first] }
            return [field]
        }

        // MARK: - Materials

        /// Glass on tvOS 26, dark blur before it, with the same rounded shape.
        private static func surface(cornerRadius: CGFloat) -> UIVisualEffectView {
            if #available(tvOS 26.0, *) {
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

        private static func pill(prominent: Bool = false) -> UIButton.Configuration {
            var configuration: UIButton.Configuration
            if #available(tvOS 26.0, *) {
                configuration = prominent ? .prominentGlass() : .glass()
            } else {
                configuration = prominent ? .filled() : .gray()
            }
            configuration.cornerStyle = .capsule
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 28, bottom: 0, trailing: 28)
            configuration.imagePadding = 12
            configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 20, weight: .bold)
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var updated = attributes
                updated.font = UIFont.systemFont(ofSize: 26, weight: .semibold)
                return updated
            }
            return configuration
        }

        private static func row() -> UIButton.Configuration {
            var configuration: UIButton.Configuration
            if #available(tvOS 26.0, *) {
                configuration = .glass()
            } else {
                configuration = .gray()
            }
            configuration.cornerStyle = .fixed
            configuration.background.cornerRadius = rowCornerRadius
            configuration.titleAlignment = .leading
            configuration.imagePadding = 22
            configuration.titlePadding = 4
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 18, leading: 24, bottom: 18, trailing: 24)
            configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 44, weight: .medium)
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var updated = attributes
                updated.font = UIFont.systemFont(ofSize: 27, weight: .medium)
                return updated
            }
            configuration.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var updated = attributes
                updated.font = UIFont.systemFont(ofSize: 20, weight: .regular)
                updated.foregroundColor = dim
                return updated
            }
            return configuration
        }

        // MARK: - Layout

        private func buildCard() {
            card.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(card)
            NSLayoutConstraint.activate([
                card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                card.widthAnchor.constraint(equalToConstant: Self.cardSize.width),
                card.heightAnchor.constraint(equalToConstant: Self.cardSize.height),
            ])
            let content = card.contentView

            titleLabel.font = UIFont.systemFont(ofSize: 40, weight: .bold)
            titleLabel.textColor = .white

            buildCurrentRow()

            languageButton.configuration?.image = UIImage(systemName: "chevron.down")
            languageButton.configuration?.imagePlacement = .trailing
            languageButton.setContentHuggingPriority(.required, for: .horizontal)
            languageButton.setContentCompressionResistancePriority(.required, for: .horizontal)
            if #available(tvOS 17.0, *) {
                languageButton.showsMenuAsPrimaryAction = true
            } else {
                languageButton.addTarget(self, action: #selector(nextLanguage), for: .primaryActionTriggered)
            }

            field.borderStyle = .none
            field.font = UIFont.systemFont(ofSize: 28, weight: .medium)
            field.textColor = .white
            field.returnKeyType = .search
            field.autocorrectionType = .no
            field.autocapitalizationType = .none
            field.delegate = self
            field.translatesAutoresizingMaskIntoConstraints = false
            fieldWell.contentView.addSubview(field)
            NSLayoutConstraint.activate([
                field.leadingAnchor.constraint(equalTo: fieldWell.contentView.leadingAnchor, constant: 28),
                field.trailingAnchor.constraint(equalTo: fieldWell.contentView.trailingAnchor, constant: -28),
                field.topAnchor.constraint(equalTo: fieldWell.contentView.topAnchor),
                field.bottomAnchor.constraint(equalTo: fieldWell.contentView.bottomAnchor),
            ])
            fieldWell.setContentHuggingPriority(.defaultLow, for: .horizontal)

            searchButton.configuration?.image = UIImage(systemName: "magnifyingglass")
            searchButton.configuration?.imagePlacement = .leading
            searchButton.setContentHuggingPriority(.required, for: .horizontal)
            searchButton.setContentCompressionResistancePriority(.required, for: .horizontal)
            searchButton.addTarget(self, action: #selector(searchPressed), for: .primaryActionTriggered)

            let controls = UIStackView(arrangedSubviews: [languageButton, fieldWell, searchButton])
            controls.axis = .horizontal
            controls.spacing = 16
            controls.alignment = .fill
            controls.heightAnchor.constraint(equalToConstant: Self.controlHeight).isActive = true

            stateLabel.font = UIFont.systemFont(ofSize: 24, weight: .semibold)
            stateLabel.textColor = Self.dim
            noteLabel.font = UIFont.systemFont(ofSize: 22, weight: .regular)
            noteLabel.textColor = Self.dim
            noteLabel.numberOfLines = 2
            spinner.color = Self.accent
            spinner.hidesWhenStopped = true
            let stateRow = UIStackView(arrangedSubviews: [spinner, stateLabel])
            stateRow.axis = .horizontal
            stateRow.spacing = 14
            stateRow.alignment = .center

            resultsStack.axis = .vertical
            resultsStack.spacing = 10
            resultsStack.translatesAutoresizingMaskIntoConstraints = false
            resultsScroll.translatesAutoresizingMaskIntoConstraints = false
            resultsScroll.contentInsetAdjustmentBehavior = .never
            resultsScroll.contentInset = UIEdgeInsets(top: 24, left: 0, bottom: 48, right: 0)
            resultsScroll.addSubview(resultsStack)
            NSLayoutConstraint.activate([
                resultsStack.topAnchor.constraint(equalTo: resultsScroll.contentLayoutGuide.topAnchor),
                resultsStack.bottomAnchor.constraint(equalTo: resultsScroll.contentLayoutGuide.bottomAnchor),
                resultsStack.leadingAnchor.constraint(equalTo: resultsScroll.contentLayoutGuide.leadingAnchor, constant: Self.margin),
                resultsStack.trailingAnchor.constraint(equalTo: resultsScroll.contentLayoutGuide.trailingAnchor, constant: -Self.margin),
                resultsStack.widthAnchor.constraint(equalTo: resultsScroll.frameLayoutGuide.widthAnchor, constant: -2 * Self.margin),
            ])

            let stack = UIStackView(arrangedSubviews: [titleLabel, currentRow, controls, stateRow, noteLabel])
            stack.axis = .vertical
            stack.spacing = 22
            stack.setCustomSpacing(28, after: titleLabel)
            stack.setCustomSpacing(28, after: currentRow)
            stack.setCustomSpacing(12, after: stateRow)
            stack.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(stack)
            content.addSubview(resultsScroll)
            NSLayoutConstraint.activate([
                stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 48),
                stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: Self.margin),
                stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -Self.margin),
                resultsScroll.topAnchor.constraint(equalTo: stack.bottomAnchor),
                resultsScroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
                resultsScroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
                resultsScroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            ])
        }

        /// The subtitle that is on: its name and source on the left, Earlier, the offset, Later and Reset on the right.
        private func buildCurrentRow() {
            currentName.font = UIFont.systemFont(ofSize: 27, weight: .medium)
            currentName.textColor = .white
            currentMeta.font = UIFont.systemFont(ofSize: 20, weight: .regular)
            currentMeta.textColor = Self.dim
            let text = UIStackView(arrangedSubviews: [currentName, currentMeta])
            text.axis = .vertical
            text.spacing = 4
            text.setContentHuggingPriority(.defaultLow, for: .horizontal)
            text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

            earlierButton.configuration?.image = UIImage(systemName: "minus")
            laterButton.configuration?.image = UIImage(systemName: "plus")
            resetButton.configuration?.image = UIImage(systemName: "arrow.counterclockwise")
            for button in [earlierButton, laterButton, resetButton] {
                button.configuration?.imagePlacement = .leading
                button.setContentHuggingPriority(.required, for: .horizontal)
                button.setContentCompressionResistancePriority(.required, for: .horizontal)
                button.heightAnchor.constraint(equalToConstant: Self.controlHeight).isActive = true
            }
            earlierButton.addAction(UIAction { [weak self] _ in self?.onShift?(-1) }, for: .primaryActionTriggered)
            laterButton.addAction(UIAction { [weak self] _ in self?.onShift?(1) }, for: .primaryActionTriggered)
            resetButton.addAction(UIAction { [weak self] _ in self?.onShift?(nil) }, for: .primaryActionTriggered)

            offsetLabel.font = UIFont.systemFont(ofSize: 26, weight: .semibold)
            offsetLabel.textColor = Self.accent
            offsetLabel.textAlignment = .center
            offsetLabel.setContentCompressionResistancePriority(.required, for: .horizontal)

            let controls = UIStackView(arrangedSubviews: [earlierButton, offsetLabel, laterButton, resetButton])
            controls.axis = .horizontal
            controls.spacing = 16
            controls.alignment = .center

            currentRow.axis = .horizontal
            currentRow.spacing = 24
            currentRow.alignment = .center
            currentRow.addArrangedSubview(text)
            currentRow.addArrangedSubview(controls)
            currentRow.isHidden = true
        }

        // MARK: - Actions

        @objc private func searchPressed() {
            field.resignFirstResponder()
            let query = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty else { return }
            onQueryChanged?(query)
        }

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
            currentRow.isHidden = next.current == nil
            if let current = next.current {
                currentName.text = current.name
                currentMeta.text = current.meta
                offsetLabel.text = current.offsetLabel
                earlierButton.configuration?.title = current.earlierLabel
                laterButton.configuration?.title = current.laterLabel
                resetButton.configuration?.title = current.resetLabel
            }
            languageButton.configuration?.title = next.languages.indices.contains(next.selectedLanguageIndex) ? next.languages[next.selectedLanguageIndex].name : next.selectedLanguage
            if #available(tvOS 17.0, *) {
                languageButton.menu = languageMenu()
            }
            searchButton.configuration?.title = next.searchLabel
            if !field.isEditing, field.text != next.query { field.text = next.query }
            field.attributedPlaceholder = NSAttributedString(string: next.queryPlaceholder, attributes: [.foregroundColor: UIColor(white: 0.5, alpha: 1)])
            stateLabel.text = next.stateLine
            noteLabel.text = next.note
            noteLabel.isHidden = next.note.isEmpty
            if next.busy { spinner.startAnimating() } else { spinner.stopAnimating() }
            if force || previous.results.count != next.results.count {
                rebuildRows()
            } else if let changed = next.changedResultRows(from: previous) {
                for index in changed where index < rows.count { configure(rows[index], with: next.results[index]) }
            }
        }

        private func rebuildRows() {
            rows.forEach { $0.removeFromSuperview() }
            rows = state.results.enumerated().map { position, result in
                let button = UIButton(configuration: Self.row())
                button.contentHorizontalAlignment = .leading
                configure(button, with: result)
                button.addAction(
                    UIAction { [weak self] _ in
                        guard let self, position < self.state.results.count else { return }
                        let current = self.state.results[position]
                        guard !current.applying, !current.applied else { return }
                        self.onPick?(current.id)
                    }, for: .primaryActionTriggered
                )
                return button
            }
            rows.forEach(resultsStack.addArrangedSubview)
            setNeedsFocusUpdate()
        }

        /// The source letter as its SF Symbol square; a saved row shows the tick instead.
        private func configure(_ button: UIButton, with result: SubtitlePanelResult) {
            var configuration = button.configuration ?? Self.row()
            let letter = result.monogram.lowercased()
            configuration.image = result.applied ? UIImage(systemName: "checkmark.circle.fill") : UIImage(systemName: "\(letter).square.fill") ?? UIImage(systemName: "captions.bubble.fill")
            configuration.imageColorTransformer = result.hashMatch || result.applied ? UIConfigurationColorTransformer { _ in Self.accent } : nil
            configuration.showsActivityIndicator = result.applying
            configuration.title = result.name
            let badges = result.badges.joined(separator: "  ")
            configuration.subtitle = badges.isEmpty ? result.meta : "\(badges)  ·  \(result.meta)"
            button.configuration = configuration
            button.alpha = result.applied ? 0.7 : 1
        }

        // MARK: - Dismissal

        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            if presses.contains(where: { $0.type == .menu }) {
                close()
                return
            }
            super.pressesBegan(presses, with: event)
        }

        private func close() {
            dismiss(animated: true) { [weak self] in
                guard let self, !self.quiet else { return }
                self.onDismissed?()
            }
        }

        /// A dismissal JS asked for: no dismissed event goes back.
        func closeQuietly(completion: @escaping () -> Void) {
            quiet = true
            dismiss(animated: true, completion: completion)
        }

        // MARK: - UITextFieldDelegate

        func textFieldDidEndEditing(_ textField: UITextField) {
            let query = (textField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty, query != state.query else { return }
            onQueryChanged?(query)
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            textField.resignFirstResponder()
            return true
        }
    }

#endif
