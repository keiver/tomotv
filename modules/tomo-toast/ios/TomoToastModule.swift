import ExpoModulesCore
import UIKit

struct ToastThemeRecord: Record {
  @Field var tint: UIColor?
  @Field var text: UIColor?
  @Field var danger: UIColor?
  @Field var closeLabel: String?
}

struct ToastRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var message: String?
  @Field var kind: String = "info"
  @Field var icon: String?
  @Field var progress: Bool = false
  @Field var durationMs: Double = 4000
  @Field var edge: String?
}

public final class TomoToastModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TomoToast")

    Events("onShow", "onDismiss")

    // A reload creates the next module before destroying this one: clear the sink only if it is ours.
    OnCreate {
      let owner = ObjectIdentifier(self)
      weak let module = self
      DispatchQueue.main.async {
        ToastCenter.shared.emit = { name, body in module?.sendEvent(name, body) }
        ToastCenter.shared.emitOwner = owner
      }
    }

    OnDestroy {
      let owner = ObjectIdentifier(self)
      DispatchQueue.main.async {
        guard ToastCenter.shared.emitOwner == owner else { return }
        ToastCenter.shared.emit = nil
        ToastCenter.shared.emitOwner = nil
      }
    }

    AsyncFunction("configure") { (record: ToastThemeRecord) in
      var theme = ToastCenter.shared.theme
      if let tint = record.tint { theme.tint = tint }
      if let text = record.text { theme.text = text }
      if let danger = record.danger { theme.danger = danger }
      if let label = record.closeLabel { theme.closeLabel = label }
      ToastCenter.shared.theme = theme
    }.runOnQueue(.main)

    AsyncFunction("show") { (record: ToastRecord) in
      guard !record.id.isEmpty, !record.title.isEmpty else { return }
      ToastCenter.shared.show(ToastModel(
        id: record.id,
        title: record.title,
        message: record.message?.isEmpty == false ? record.message : nil,
        kind: ToastKind(rawValue: record.kind) ?? .info,
        icon: record.icon,
        progress: record.progress,
        duration: max(1, record.durationMs / 1000),
        edge: record.edge.flatMap(ToastEdge.init(rawValue:)) ?? .platform
      ))
    }.runOnQueue(.main)

    AsyncFunction("dismiss") { (id: String) in
      ToastCenter.shared.dismiss(id: id, reason: .api)
    }.runOnQueue(.main)

    AsyncFunction("dismissAll") {
      ToastCenter.shared.dismissAll()
    }.runOnQueue(.main)
  }
}
