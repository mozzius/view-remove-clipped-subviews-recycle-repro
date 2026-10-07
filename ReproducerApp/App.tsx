/**
 * removeClippedSubviews is lost on a recycled view (iOS, New Architecture).
 *
 * A ScrollView with `removeClippedSubviews` and 100 rows. Its content view is
 * a plain RCTViewComponentView. On first mount only the rows near the
 * viewport stay attached. Remount it (unmount, then mount the same tree) and
 * the content view comes back from the recycle pool with clipping off, so all
 * 100 rows are attached.
 *
 * The numbers come from AppDelegate.swift, which reads the content view's
 * native state every 100ms and publishes it through NSUserDefaults (read here
 * with `Settings`). The stock/fix switch only works with the patch in
 * patches/ compiled in (see the README).
 *
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Settings,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

const ROWS = 100;
const ROW_HEIGHT = 60;
const SETTLE_MS = 800;

type Mode = 'stock' | 'fix';

type Stats = {
  view: string;
  clip: boolean;
  attached: number;
  tracked: number;
};

type Result = {
  mount: number;
  mode: Mode;
  stats: Stats | null;
  sameAs: number | null;
};

const token = Math.random().toString(36).slice(2);

// Every launch starts in stock mode.
Settings.set({ ReproToken: token, ReproRecycleFix: false });

function readStats(): Stats | null {
  const raw = Settings.get('ReproClipStats');
  if (typeof raw !== 'string' || raw === 'none') {
    return null;
  }
  return JSON.parse(raw) as Stats;
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <Screen />
    </SafeAreaProvider>
  );
}

function Screen() {
  const insets = useSafeAreaInsets();
  const [mode, setModeState] = useState<Mode>('stock');
  const [mounted, setMounted] = useState(true);
  const [mountCount, setMountCount] = useState(1);
  const [live, setLive] = useState<Stats | null>(null);
  const [patch, setPatch] = useState<'unseen' | 'active'>('unseen');
  const [results, setResults] = useState<Result[]>([]);
  const modeRef = useRef<Mode>('stock');

  useEffect(() => {
    const id = Settings.watchKeys(
      ['ReproClipStats', 'ReproTokenEcho'],
      () => {
        setLive(readStats());
        if (Settings.get('ReproTokenEcho') === token) {
          setPatch('active');
        }
      },
    );
    return () => Settings.clearWatch(id);
  }, []);

  // Record the native state once each mount has settled.
  useEffect(() => {
    if (!mounted) {
      return;
    }
    const mount = mountCount;
    const mountMode = modeRef.current;
    const timer = setTimeout(() => {
      const stats = readStats();
      setResults(prev => {
        const earlier = prev.find(r => r.stats?.view === stats?.view);
        const result: Result = {
          mount,
          mode: mountMode,
          stats,
          sameAs: earlier ? earlier.mount : null,
        };
        console.log(`[repro] mount ${mount} (${mountMode}): ${describe(result)}`);
        return [...prev, result];
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [mounted, mountCount]);

  const setMode = (next: Mode) => {
    modeRef.current = next;
    setModeState(next);
    Settings.set({ ReproRecycleFix: next === 'fix' });
    console.log(`[repro] mode ${next}`);
  };

  const remount = () => {
    console.log('[repro] unmount');
    setMounted(false);
    // Mount again in a separate commit, so the old views are recycled first.
    setTimeout(() => {
      console.log('[repro] mount');
      setMountCount(c => c + 1);
      setMounted(true);
    }, 300);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>removeClippedSubviews after recycling</Text>
      <Text
        style={[
          styles.small,
          patch === 'active' ? styles.ok : styles.warn,
        ]}>
        {patch === 'active'
          ? 'Native patch active: the stock/fix switch works'
          : 'Native patch not seen yet (or prebuilt core): stock only'}
      </Text>

      <View style={styles.controls}>
        <Button
          label="stock"
          selected={mode === 'stock'}
          onPress={() => setMode('stock')}
        />
        <Button
          label="fix"
          selected={mode === 'fix'}
          onPress={() => setMode('fix')}
        />
        <View style={styles.spacer} />
        <Button label="Remount" onPress={remount} />
      </View>

      <Text style={styles.small}>
        {'Now: '}
        {live
          ? `content view ${short(live.view)}, clipping ${
              live.clip ? 'on' : 'off'
            }, ${live.attached}/${ROWS} attached`
          : 'not mounted'}
      </Text>

      <Text style={styles.results}>
        {results.slice(-8).map(r => (
          <Text key={r.mount}>
            {`#${r.mount} ${r.mode.padEnd(5)} `}
            <Text style={verdictStyle(r)}>{describe(r)}</Text>
            {'\n'}
          </Text>
        ))}
      </Text>

      {/* The box stays mounted, so unmounting takes no view from the pool. */}
      <View style={styles.box}>
        {mounted ? (
          <ScrollView testID="clip-scroll" removeClippedSubviews>
            {Array.from({ length: ROWS }, (_, i) => (
              <View
                key={i}
                collapsable={false}
                style={[styles.row, i % 2 ? styles.rowOdd : styles.rowEven]}>
                <Text>row {i}</Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

function Button({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, selected && styles.buttonSelected]}>
      <Text style={selected ? styles.buttonTextSelected : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

function short(view: string) {
  return '0x' + view.replace(/^0x0*/, '').slice(-5);
}

function describe(r: Result) {
  if (!r.stats) {
    return 'no content view found';
  }
  const view = `${short(r.stats.view)}${r.sameAs ? ` (=#${r.sameAs})` : ''}`;
  return `${view} clipping ${r.stats.clip ? 'on' : 'OFF'}, ${
    r.stats.attached
  }/${ROWS} attached`;
}

function verdictStyle(r: Result) {
  return r.stats?.clip ? styles.ok : styles.bad;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 12, backgroundColor: 'white' },
  title: { fontSize: 17, fontWeight: '600' },
  small: { fontSize: 13, marginTop: 6 },
  ok: { color: '#08780f' },
  warn: { color: '#b56a00' },
  bad: { color: '#c00000', fontWeight: '600' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  spacer: { flex: 1 },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  buttonSelected: { backgroundColor: '#222', borderColor: '#222' },
  buttonTextSelected: { color: 'white' },
  results: {
    fontFamily: 'Menlo',
    fontSize: 11,
    marginTop: 8,
    minHeight: 120,
  },
  box: {
    height: 360,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  row: {
    height: ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  rowEven: { backgroundColor: '#eef3ff' },
  rowOdd: { backgroundColor: '#ffffff' },
});

export default App;
