//
//  SubtitleSearchPanelViewController.swift
//  TomoTV
//
//  The tvOS subtitle panel: a rounded blurred card over the playing video with the language
//  chips, the search field, a state line and the results. Every string arrives from JS.
//

#if os(tvOS)

    import UIKit

    final class SubtitleSearchPanelViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UITextFieldDelegate {
        var onQueryChanged: ((String) -> Void)?
        var onLanguageChanged: ((String) -> Void)?
        var onPick: ((String) -> Void)?
        var onDismissed: (() -> Void)?

        private var state: SubtitlePanelState
        private var quiet = false

        private let card = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
        private let titleLabel = UILabel()
        private let chipsStack = UIStackView()
        private var chipButtons: [UIButton] = []
        private let field = UITextField()
        private let stateLabel = UILabel()
        private let noteLabel = UILabel()
        private let spinner = UIActivityIndicatorView(style: .large)
        private let table = UITableView(frame: .zero, style: .plain)

        private static let cardSize = CGSize(width: 1180, height: 760)
        private static let accent = UIColor(red: 1.0, green: 0.764, blue: 0.07, alpha: 1.0)

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
            if let first = chipButtons.first(where: { $0.isSelected }) { return [first] }
            return chipButtons.isEmpty ? [field] : [chipButtons[0]]
        }

        // MARK: - Layout

        private func buildCard() {
            card.translatesAutoresizingMaskIntoConstraints = false
            card.layer.cornerRadius = 44
            card.layer.cornerCurve = .continuous
            card.clipsToBounds = true
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

            chipsStack.axis = .horizontal
            chipsStack.spacing = 14
            chipsStack.alignment = .center

            field.borderStyle = .none
            field.font = UIFont.systemFont(ofSize: 30, weight: .medium)
            field.textColor = .white
            field.backgroundColor = UIColor.white.withAlphaComponent(0.08)
            field.layer.cornerRadius = 18
            field.layer.cornerCurve = .continuous
            field.returnKeyType = .search
            field.autocorrectionType = .no
            field.autocapitalizationType = .none
            field.delegate = self
            field.heightAnchor.constraint(equalToConstant: 72).isActive = true
            field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 24, height: 1))
            field.leftViewMode = .always

            stateLabel.font = UIFont.systemFont(ofSize: 24, weight: .semibold)
            stateLabel.textColor = UIColor(white: 0.62, alpha: 1)
            noteLabel.font = UIFont.systemFont(ofSize: 22, weight: .regular)
            noteLabel.textColor = UIColor(white: 0.62, alpha: 1)
            noteLabel.numberOfLines = 2
            spinner.color = Self.accent
            spinner.hidesWhenStopped = true

            let stateRow = UIStackView(arrangedSubviews: [spinner, stateLabel])
            stateRow.axis = .horizontal
            stateRow.spacing = 14
            stateRow.alignment = .center

            table.backgroundColor = .clear
            table.separatorStyle = .none
            table.dataSource = self
            table.delegate = self
            table.remembersLastFocusedIndexPath = true
            table.register(SubtitleResultCell.self, forCellReuseIdentifier: SubtitleResultCell.reuseIdentifier)
            table.rowHeight = 112

            let stack = UIStackView(arrangedSubviews: [titleLabel, chipsStack, field, stateRow, noteLabel, table])
            stack.axis = .vertical
            stack.spacing = 22
            stack.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 48),
                stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 56),
                stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -56),
                stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -40),
            ])
        }

        private func chip(title: String, tag: Int) -> UIButton {
            var configuration = UIButton.Configuration.filled()
            configuration.title = title
            configuration.baseBackgroundColor = UIColor.white.withAlphaComponent(0.1)
            configuration.baseForegroundColor = .white
            configuration.cornerStyle = .capsule
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 26, bottom: 12, trailing: 26)
            let button = UIButton(configuration: configuration)
            button.tag = tag
            button.addTarget(self, action: #selector(chipPressed(_:)), for: .primaryActionTriggered)
            button.configurationUpdateHandler = { button in
                var updated = button.configuration
                let selected = button.isSelected
                let focused = button.isFocused
                updated?.baseBackgroundColor = selected ? Self.accent : UIColor.white.withAlphaComponent(focused ? 0.28 : 0.1)
                updated?.baseForegroundColor = selected ? .black : .white
                button.configuration = updated
            }
            return button
        }

        @objc private func chipPressed(_ sender: UIButton) {
            guard sender.tag < state.languages.count else { return }
            let code = state.languages[sender.tag].code
            guard code != state.selectedLanguage else { return }
            onLanguageChanged?(code)
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
            if force || previous.languages != next.languages {
                chipButtons.forEach { $0.removeFromSuperview() }
                chipButtons = next.languages.enumerated().map { chip(title: $0.element.name, tag: $0.offset) }
                chipButtons.forEach(chipsStack.addArrangedSubview)
            }
            for (position, button) in chipButtons.enumerated() {
                button.isSelected = position == next.selectedLanguageIndex
                button.setNeedsUpdateConfiguration()
            }
            if !field.isEditing, field.text != next.query { field.text = next.query }
            field.attributedPlaceholder = NSAttributedString(string: next.queryPlaceholder, attributes: [.foregroundColor: UIColor(white: 0.5, alpha: 1)])
            stateLabel.text = next.stateLine
            noteLabel.text = next.note
            noteLabel.isHidden = next.note.isEmpty
            if next.busy { spinner.startAnimating() } else { spinner.stopAnimating() }
            if force || previous.results.count != next.results.count {
                table.reloadData()
            } else if let rows = next.changedResultRows(from: previous), !rows.isEmpty {
                table.reloadRows(at: rows.map { IndexPath(row: $0, section: 0) }, with: .none)
            }
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

        // MARK: - UITableViewDataSource

        func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
            state.results.count
        }

        func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
            let cell = tableView.dequeueReusableCell(withIdentifier: SubtitleResultCell.reuseIdentifier, for: indexPath)
            if let resultCell = cell as? SubtitleResultCell, indexPath.row < state.results.count {
                resultCell.configure(state.results[indexPath.row], accent: Self.accent)
            }
            return cell
        }

        // MARK: - UITableViewDelegate

        func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
            guard indexPath.row < state.results.count else { return }
            let result = state.results[indexPath.row]
            guard !result.applying, !result.applied else { return }
            onPick?(result.id)
        }
    }

    /// One result: a source monogram, the release name, its badges and meta, a mark on the right.
    final class SubtitleResultCell: UITableViewCell {
        static let reuseIdentifier = "SubtitleResultCell"

        private let monogram = UILabel()
        private let name = UILabel()
        private let meta = UILabel()
        private let mark = UIImageView()
        private let spinner = UIActivityIndicatorView(style: .medium)
        private let frameView = UIView()

        override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
            super.init(style: style, reuseIdentifier: reuseIdentifier)
            backgroundColor = .clear
            selectionStyle = .none
            focusStyle = .custom

            frameView.translatesAutoresizingMaskIntoConstraints = false
            frameView.layer.cornerRadius = 20
            frameView.layer.cornerCurve = .continuous
            frameView.layer.borderWidth = 3
            frameView.layer.borderColor = UIColor.clear.cgColor
            contentView.addSubview(frameView)

            monogram.font = UIFont.systemFont(ofSize: 28, weight: .bold)
            monogram.textColor = .white
            monogram.textAlignment = .center
            monogram.backgroundColor = UIColor.white.withAlphaComponent(0.14)
            monogram.layer.cornerRadius = 14
            monogram.layer.cornerCurve = .continuous
            monogram.clipsToBounds = true
            monogram.translatesAutoresizingMaskIntoConstraints = false

            name.font = UIFont.systemFont(ofSize: 27, weight: .medium)
            name.textColor = .white
            meta.font = UIFont.systemFont(ofSize: 20, weight: .regular)
            meta.textColor = UIColor(white: 0.62, alpha: 1)
            let text = UIStackView(arrangedSubviews: [name, meta])
            text.axis = .vertical
            text.spacing = 4
            text.translatesAutoresizingMaskIntoConstraints = false

            mark.contentMode = .scaleAspectFit
            mark.translatesAutoresizingMaskIntoConstraints = false
            spinner.hidesWhenStopped = true
            spinner.translatesAutoresizingMaskIntoConstraints = false

            frameView.addSubview(monogram)
            frameView.addSubview(text)
            frameView.addSubview(mark)
            frameView.addSubview(spinner)
            NSLayoutConstraint.activate([
                frameView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
                frameView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
                frameView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
                frameView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
                monogram.leadingAnchor.constraint(equalTo: frameView.leadingAnchor, constant: 20),
                monogram.centerYAnchor.constraint(equalTo: frameView.centerYAnchor),
                monogram.widthAnchor.constraint(equalToConstant: 60),
                monogram.heightAnchor.constraint(equalToConstant: 60),
                text.leadingAnchor.constraint(equalTo: monogram.trailingAnchor, constant: 22),
                text.centerYAnchor.constraint(equalTo: frameView.centerYAnchor),
                text.trailingAnchor.constraint(lessThanOrEqualTo: mark.leadingAnchor, constant: -20),
                mark.trailingAnchor.constraint(equalTo: frameView.trailingAnchor, constant: -24),
                mark.centerYAnchor.constraint(equalTo: frameView.centerYAnchor),
                mark.widthAnchor.constraint(equalToConstant: 36),
                mark.heightAnchor.constraint(equalToConstant: 36),
                spinner.centerXAnchor.constraint(equalTo: mark.centerXAnchor),
                spinner.centerYAnchor.constraint(equalTo: mark.centerYAnchor),
            ])
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

        func configure(_ result: SubtitlePanelResult, accent: UIColor) {
            monogram.text = result.monogram
            monogram.backgroundColor = result.hashMatch ? accent : UIColor.white.withAlphaComponent(0.14)
            monogram.textColor = result.hashMatch ? .black : .white
            name.text = result.name
            let badges = result.badges.joined(separator: "  ")
            meta.text = badges.isEmpty ? result.meta : "\(badges)  ·  \(result.meta)"
            mark.tintColor = result.applied ? accent : UIColor(white: 0.62, alpha: 1)
            mark.image = UIImage(systemName: result.applied ? "checkmark.circle.fill" : "arrow.down.circle")
            mark.isHidden = result.applying
            if result.applying { spinner.startAnimating() } else { spinner.stopAnimating() }
            contentView.alpha = result.applied ? 0.7 : 1
            frameView.layer.borderColor = isFocused ? accent.cgColor : UIColor.clear.cgColor
        }

        override func didUpdateFocus(in context: UIFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
            super.didUpdateFocus(in: context, with: coordinator)
            let focused = isFocused
            coordinator.addCoordinatedAnimations({ [weak self] in
                self?.frameView.backgroundColor = focused ? UIColor.white.withAlphaComponent(0.12) : .clear
                self?.frameView.layer.borderColor = focused ? UIColor(red: 1.0, green: 0.764, blue: 0.07, alpha: 1.0).cgColor : UIColor.clear.cgColor
            }, completion: nil)
        }
    }

#endif
