import ExpoModulesCore

public final class LiveClipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveClip")

    View(LiveClipView.self) {
      Prop("uri") { (view, uri: String?) in
        view.show(uri.flatMap(URL.init(string:)))
      }
    }
  }
}
