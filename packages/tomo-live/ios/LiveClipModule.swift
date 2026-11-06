import ExpoModulesCore

public final class LiveClipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveClip")

    View(LiveClipView.self) {
      Events("onFailed", "onPlaying")

      Prop("uri") { (view, uri: String?) in
        view.show(uri.flatMap(URL.init(string:)))
      }

      Prop("live") { (view, live: Bool?) in
        view.setLive(live ?? false)
      }

      Prop("muted") { (view, muted: Bool?) in
        view.setMuted(muted ?? true)
      }
    }
  }
}
