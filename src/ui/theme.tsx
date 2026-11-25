import { createContext, type ReactNode, useContext, useMemo } from 'react';
import {
  type ImageStyle,
  StyleSheet,
  type TextStyle,
  useColorScheme,
  type ViewStyle,
} from 'react-native';

import { type Colors, DARK_COLORS, LIGHT_COLORS } from './tokens';

/** Forces a scheme for a subtree (Off the record is always dark). */
const Forced = createContext<'light' | 'dark' | null>(null);

export function ForceScheme({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark' | null;
  children: ReactNode;
}) {
  return <Forced.Provider value={scheme}>{children}</Forced.Provider>;
}

export function useScheme(): 'light' | 'dark' {
  const forced = useContext(Forced);
  const system = useColorScheme();
  return forced ?? (system === 'dark' ? 'dark' : 'light');
}

export function useColors(): Colors {
  return useScheme() === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

/**
 * Theme-aware styles: `const useStyles = makeStyles((c) => ({ … }))` at module level, then
 * `const s = useStyles()` in the component (memoised per colour scheme).
 */
type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;

export function makeStyles<T extends Styles>(build: (c: Colors) => T): () => T {
  const cache = new Map<Colors, T>();
  return function useStyles() {
    const c = useColors();
    return useMemo(() => {
      let s = cache.get(c);
      if (!s) {
        s = StyleSheet.create(build(c));
        cache.set(c, s);
      }
      return s;
    }, [c]);
  };
}
