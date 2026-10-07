import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "ReproducerApp",
      in: window,
      launchOptions: launchOptions
    )

    startPublishingClipStats()

    return true
  }

  // MARK: - Repro diagnostics

  // Every 100ms, find the content view of the ScrollView with testID
  // "clip-scroll" and publish its native clipping state to NSUserDefaults
  // (key "ReproClipStats"), where App.tsx reads it with `Settings`. The ivars
  // are read with KVC, for diagnostics only.
  private var statsTimer: Timer?
  private var lastStats: String?

  private func startPublishingClipStats() {
    statsTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
      self?.publishClipStats()
    }
  }

  private func publishClipStats() {
    var stats = "none"
    if let window,
      let scrollView = findView(in: window, where: { $0.accessibilityIdentifier == "clip-scroll" }),
      let viewClass = NSClassFromString("RCTViewComponentView"),
      let content = findView(in: scrollView, where: { $0.isMember(of: viewClass) })
    {
      let clip = (content.value(forKey: "_removeClippedSubviews") as? Bool) ?? false
      let tracked = (content.value(forKey: "_reactSubviews") as? NSArray)?.count ?? 0
      let pointer = Unmanaged.passUnretained(content).toOpaque()
      stats =
        "{\"view\":\"\(pointer)\",\"clip\":\(clip),\"attached\":\(content.subviews.count),\"tracked\":\(tracked)}"
    }
    if stats != lastStats {
      lastStats = stats
      NSLog("[clip] native state: %@", stats)
      UserDefaults.standard.set(stats, forKey: "ReproClipStats")
    }
  }

  // Breadth-first search below `root` (not including it).
  private func findView(in root: UIView, where match: (UIView) -> Bool) -> UIView? {
    var queue = root.subviews
    while !queue.isEmpty {
      let view = queue.removeFirst()
      if match(view) {
        return view
      }
      queue.append(contentsOf: view.subviews)
    }
    return nil
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
