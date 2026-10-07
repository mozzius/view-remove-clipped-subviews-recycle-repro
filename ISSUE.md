# iOS: `removeClippedSubviews` is lost when a view is recycled

### Description

On iOS with the New Architecture, `removeClippedSubviews` only works the first time a view with it is mounted. When that view is recycled and handed out again for another view with `removeClippedSubviews`, clipping stays off, so every child stays attached. A `ScrollView` or `FlatList` with `removeClippedSubviews` that is unmounted and mounted again (for example, by navigating away and back) keeps all its rows in the native view hierarchy.

In the repro, a `ScrollView` with `removeClippedSubviews` and 100 rows is mounted, unmounted and mounted again. Its content view comes back from the recycle pool (the same instance each time):

| | First mount | Each later mount |
| --- | --- | --- |
| 0.87.1, unmodified | 7/100 rows attached | **100/100** (3/3) |
| 0.87.1 with the fix | 7/100 | 7/100 (3/3) |

#### Cause

`updateProps:oldProps:` diffs against the view's own `_props`, not the `oldProps` argument ([L348](https://github.com/react/react-native/blob/bf62cce504e/packages/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm#L348)). It only sets `_removeClippedSubviews` when that diff changes ([L362](https://github.com/react/react-native/blob/bf62cce504e/packages/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm#L362)):

```objc
if (oldViewProps.removeClippedSubviews != newViewProps.removeClippedSubviews) {
```

`prepareForRecycle` resets `_removeClippedSubviews = NO` ([L781](https://github.com/react/react-native/blob/bf62cce504e/packages/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm#L781)) but keeps `_props`. So when a recycled view whose last props had `removeClippedSubviews` gets it again, the diff sees no change and the flag stays `NO`: children are mounted straight into the view, and nothing is clipped.

#### Fix

Compare against `_removeClippedSubviews` rather than `_props`. PR to follow.

### Steps to reproduce

1. `git clone https://github.com/mozzius/view-remove-clipped-subviews-recycle-repro && cd view-remove-clipped-subviews-recycle-repro/ReproducerApp && yarn install`
2. `cd ios && bundle install && RCT_USE_PREBUILT_RNCORE=0 bundle exec pod install && cd ..` (building core from source is only needed for the repro's **fix** switch)
3. `yarn start`, then `yarn ios`
4. On launch, the readout shows `#1 stock ... clipping on, 7/100 attached`. Tap **Remount**: `#2 stock ... (=#1) clipping OFF, 100/100 attached`.
5. Tap **fix**, then **Remount**: `clipping on, 7/100 attached`.

### React Native Version

0.87.1. The code is the same on `main`.

### Affected Platforms

Runtime - iOS

### Output of `npx @react-native-community/cli info`

```text
System:
  OS: macOS 27.0.1
IDEs:
  Xcode: 27.0/27A266a
npmPackages:
  react: 19.2.3
  react-native: 0.87.1
iOS:
  hermesEnabled: true
  newArchEnabled: true
```

### Stacktrace or Logs

```text
// first mount
[clip] RCTViewComponentView 0x10825b300 updateProps (stock): removeClippedSubviews=1, _props says 0, ivar is 0 -> toggle
[clip] native state: {"view":"0x000000010825b300","clip":true,"attached":7,"tracked":100}
// unmount
[clip] RCTViewComponentView 0x10825b300 prepareForRecycle: ivar 1 -> 0, _props keeps removeClippedSubviews=1
// mount again
[clip] RCTViewComponentView 0x10825b300 updateProps (stock): removeClippedSubviews=1, _props says 1, ivar is 0 -> no change
[clip] native state: {"view":"0x000000010825b300","clip":false,"attached":100,"tracked":0}
```

The full logs are in the repro's [`evidence/`](https://github.com/mozzius/view-remove-clipped-subviews-recycle-repro/tree/main/evidence).

### MANDATORY Reproducer

https://github.com/mozzius/view-remove-clipped-subviews-recycle-repro

### Screenshots and Videos

[`ios-demo.mp4`](https://github.com/mozzius/view-remove-clipped-subviews-recycle-repro/blob/main/evidence/ios-demo.mp4): three remounts on stock, two with the fix, then stock again.
