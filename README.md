# iOS: `removeClippedSubviews` is lost on a recycled view

On iOS with the New Architecture, `removeClippedSubviews` only works the first
time a view with it is mounted. Fabric recycles native views, and when a view
that had `removeClippedSubviews` comes back out of the recycle pool for another
view that sets it, clipping stays off. A `ScrollView` or `FlatList` with
`removeClippedSubviews` that is unmounted and mounted again keeps every row
attached to the native view hierarchy.

| Mount | Content view | Clipping (native) | Rows attached |
| --- | --- | --- | --- |
| First | new | on | 7 / 100 |
| After a remount, stock | the same instance, recycled | **off** | **100 / 100** |
| After a remount, with the fix | the same instance, recycled | on | 7 / 100 |

The cause is in `RCTViewComponentView.mm`. `prepareForRecycle` resets
`_removeClippedSubviews` to `NO`, but keeps `_props`. `updateProps:oldProps:`
diffs the new props against `_props`, so it sees no change in
`removeClippedSubviews` and never turns the flag back on.
[`ISSUE.md`](ISSUE.md) has the details.

- **Upstream issue:** not filed yet
- **Found while building:** [scrollview-mvcp-anchor-repro](https://github.com/mozzius/scrollview-mvcp-anchor-repro)
  (see its "Other findings")

## Environment

| | |
| --- | --- |
| react-native | 0.87.1 (the code is unchanged on `main` at bf62cce) |
| react | 19.2.3 |
| Architecture | New (Fabric), Hermes |
| Reproduced on | iOS Simulator, iPhone 17 Pro, iOS 26.5, Xcode 27.0 |
| Dependencies | The template's, plus `patch-package` |

## Running it

```bash
cd ReproducerApp
yarn install                     # postinstall applies patches/ with patch-package
(cd ios && bundle install && RCT_USE_PREBUILT_RNCORE=0 bundle exec pod install)
yarn start
yarn ios
```

React Native 0.87 links its core from prebuilt XCFrameworks by default. The
patch to `RCTViewComponentView.mm` only takes effect if the core is compiled
from source, so `pod install` needs `RCT_USE_PREBUILT_RNCORE=0`. The bug itself
reproduces with the prebuilt core too; only the **fix** switch needs the source
build. The second line of the screen says in green when the patch is running
(the app writes a token to `NSUserDefaults`, and the patched native code echoes
it back), and in orange when it isn't.

A source build also honours `RCT_METRO_PORT`, if you run Metro on another port
(`yarn start --port <port>`, then build with `RCT_METRO_PORT=<port>`).

1. Launch the app. The readout's first row is the first mount: `clipping on,
   7/100 attached`.
2. Tap **Remount**. The new row says `(=#1) clipping OFF, 100/100 attached`.
3. Tap **fix**, then **Remount**: `clipping on, 7/100 attached`.

## What the screen does

A `ScrollView` with `removeClippedSubviews` and 100 rows of 60pt, in a 360pt
box. **Remount** unmounts it, and mounts the same tree again in a separate
commit 300ms later, so its views go to the recycle pool first. Navigating away
from a screen and back does the same thing.

On iOS the `ScrollView`'s content view is a plain `View`
(`RCTScrollContentView` maps to `View`), so it's an `RCTViewComponentView`
like any other. In this repro it gets its own previous instance back on every
remount: the address is the same in every row of the readout, and `(=#1)`
marks it. In an app, which pooled view a new clipping container gets depends
on the mount order. Any view whose previous life had `removeClippedSubviews`
loses it.

[`AppDelegate.swift`](ReproducerApp/ios/ReproducerApp/AppDelegate.swift) reads
the content view's native state every 100ms: its address, its
`_removeClippedSubviews` and `_reactSubviews` ivars (by KVC, for diagnostics
only), and how many rows are attached as subviews. It publishes them through
`NSUserDefaults`, and [`App.tsx`](ReproducerApp/App.tsx) reads them with
`Settings`. 800ms after each mount, the app adds a row to the readout. The
readout works with or without the patch.

## Toggling the fix

[`patches/react-native+0.87.1.patch`](ReproducerApp/patches/react-native+0.87.1.patch)
changes only `RCTViewComponentView.mm`. It reads `ReproRecycleFix` from
`NSUserDefaults` in `updateProps:oldProps:`, and the **stock** and **fix**
buttons set it with `Settings.set()`. Every launch starts in stock mode.

- **stock:** compare against `_props`, exactly as upstream.
- **fix:** compare against `_removeClippedSubviews`, the proposed fix.

The patch also logs, as `[clip]` lines, every `updateProps:` and
`prepareForRecycle` of a view that has (or had) `removeClippedSubviews`.

## Results

From [`evidence/`](evidence). The `n/n` counts include runs from earlier
builds of this app that only differed in the readout's wording.

| Build | First mount | Each later mount |
| --- | --- | --- |
| Unmodified 0.87.1 (prebuilt core) | on, 7/100 | **OFF, 100/100** (3/3) |
| 0.87.1 from source, **stock** | on, 7/100 (2/2) | **OFF, 100/100** (4/4) |
| 0.87.1 from source, **fix** | | on, 7/100 (3/3) |

With the prebuilt core the **fix** button does nothing, as expected: the
`React.framework` in that build contains none of the patch's strings.

The fix also heals a view that a stock build already broke: in the demo, mount
#4 runs the fix on the same instance that mounts #2 and #3 left with clipping
off, and clipping comes back on.

## Android

By reading only, not tested here: Android isn't affected. Recycling of
`ReactViewGroup` is behind the `enableViewRecycling` flag, which is off by
default. With it on, `ReactViewManager.prepareToRecycleView` turns
`removeClippedSubviews` off and `ReactViewGroup.recycleView()` resets the
field, and on reuse `ViewManager.createViewInstance` applies the full initial
props. The `removeClippedSubviews` setter compares against the view's own
field, not against old props, so it turns clipping back on.

## Demo video

Recorded with this app on the source build. Static stretches are trimmed, and
taps show as circles. The video carries Argent's watermark (the tool used to
record it).

**[`evidence/ios-demo.mp4`](evidence/ios-demo.mp4)**: iPhone 17 Pro simulator, iOS 26.5, 15 s.

| Time | What happens |
| --- | --- |
| 0:00 | Stock. Mount #1: `clipping on, 7/100 attached`. Tap **Remount**. |
| 0:01-0:02 | Mount #2, the same view: `clipping OFF, 100/100 attached`. |
| 0:03-0:04 | **Remount** again. Mount #3: still `OFF, 100/100`. |
| 0:05-0:06 | Tap **fix**. |
| 0:07-0:08 | **Remount**. Mount #4, the same view: `clipping on, 7/100 attached`. |
| 0:09-0:10 | **Remount**. Mount #5: on, 7/100. |
| 0:11-0:13 | Tap **stock**, then **Remount**. Mount #6: `OFF, 100/100` again. |

## Logs

| File | What |
| --- | --- |
| [`evidence/ios-demo-native.log`](evidence/ios-demo-native.log) | The demo's native `[clip]` lines: the patch's `updateProps:` and `prepareForRecycle` lines, and the readout's native state |
| [`evidence/ios-demo-js.log`](evidence/ios-demo-js.log) | The demo's JS console (mounts #2 to #6; the debugger attached after #1) |
| [`evidence/ios-prebuilt-core-native.log`](evidence/ios-prebuilt-core-native.log) | Unmodified 0.87.1 (prebuilt core): the readout's native state for four mounts. No patch lines, because the patch isn't compiled in |

Two views log each time: the content view (`RCTViewComponentView`) and the
`ScrollView` itself (`RCTScrollViewComponentView`, which gets the prop too but
manages its own clipping). The content view is the one that matters.
