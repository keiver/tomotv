import ExpoModulesCore

public final class TVMenuTrapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TVMenuTrap")

    View(TVMenuTrapView.self) {
      Events("onMenuPress")

      Prop("trapEnabled") { (view, enabled: Bool) in
        view.trapEnabled = enabled
      }
    }
  }
}
