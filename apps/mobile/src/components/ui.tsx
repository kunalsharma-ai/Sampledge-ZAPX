import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette, type Palette } from '@/lib/theme';
import type { HelpKey } from '@/lib/help';
import { InfoButton } from './info';

export type IconName = keyof typeof Ionicons.glyphMap;

/** Scrollable page with the neon backdrop, pull-to-refresh and safe-area padding. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  padded = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  padded?: boolean;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const body = padded ? { padding: 16, paddingBottom: 32 + insets.bottom, gap: 14 } : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <LinearGradient
        colors={[p.scheme === 'dark' ? '#2a1a7a55' : '#c4b5fd55', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.45 }}
        pointerEvents="none"
      />
      {scroll ? (
        <ScrollView
          contentContainerStyle={body}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.accent} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, body]}>{children}</View>
      )}
    </View>
  );
}

export function Card({ children, style, glow }: { children: ReactNode; style?: StyleProp<ViewStyle>; glow?: boolean }) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: p.surface,
          borderColor: glow ? p.edge : p.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: 16,
          gap: 10,
          shadowColor: p.accent,
          shadowOpacity: glow ? 0.35 : 0.12,
          shadowRadius: glow ? 18 : 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: glow ? 6 : 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** The gradient hero used at the top of the dashboard and feature pages. */
export function Hero({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  const p = usePalette();
  return (
    <LinearGradient
      colors={p.scheme === 'dark' ? ['#2b1a8f', '#1a1150', '#0d3a52'] : ['#ede6ff', '#fbe8ff', '#e0f7fb']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 22, padding: 20, gap: 10, borderWidth: 1, borderColor: p.edge }}
    >
      <Text style={{ color: p.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 }} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={{ color: p.muted, fontSize: 14, lineHeight: 20 }}>{subtitle}</Text> : null}
      {children}
    </LinearGradient>
  );
}

export function H2({
  children,
  right,
  help,
}: {
  children: ReactNode;
  right?: ReactNode;
  /** "i" help card key (lib/help.ts). */ help?: HelpKey;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '700' }}>
          {children}
        </Text>
        {help ? <InfoButton k={help} /> : null}
      </View>
      {right}
    </View>
  );
}

export function T({
  children,
  muted,
  style,
  size,
  bold,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  size?: number;
  bold?: boolean;
}) {
  const p = usePalette();
  return (
    <Text
      style={[
        { color: muted ? p.muted : p.text, fontSize: size ?? 14, lineHeight: (size ?? 14) * 1.4, fontWeight: bold ? '700' : '400' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Stat({
  label,
  value,
  icon,
  tone = 0,
  hint,
}: {
  label: string;
  value: string | number;
  icon?: IconName;
  tone?: number;
  hint?: string;
}) {
  const p = usePalette();
  const c = [p.accent, p.accent2, p.accent3, p.warning][tone % 4];
  return (
    <Card style={{ flex: 1, minWidth: 140, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? (
          <View style={{ backgroundColor: c + '33', borderRadius: 10, padding: 6 }}>
            <Ionicons name={icon} size={16} color={c} />
          </View>
        ) : null}
        <Text style={{ color: p.muted, fontSize: 13 }}>{label}</Text>
      </View>
      <Text style={{ color: p.text, fontSize: 26, fontWeight: '800' }}>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
      {hint ? <Text style={{ color: p.muted, fontSize: 12 }}>{hint}</Text> : null}
    </Card>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{children}</View>;
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  small,
  testID,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  testID?: string;
}) {
  const p = usePalette();
  const fg = kind === 'primary' || kind === 'danger' ? p.onAccent : kind === 'ghost' ? p.accent : p.text;
  const inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: small ? 8 : 12,
        paddingHorizontal: small ? 12 : 18,
      }}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon ? <Ionicons name={icon} size={small ? 15 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 15 }}>{title}</Text>
    </View>
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.8 : 1, borderRadius: 14, overflow: 'hidden' })}
    >
      {kind === 'primary' ? (
        <LinearGradient colors={[p.accent, p.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          {inner}
        </LinearGradient>
      ) : (
        <View
          style={{
            backgroundColor: kind === 'danger' ? p.danger : kind === 'secondary' ? p.surface2 : 'transparent',
            borderWidth: kind === 'secondary' ? 1 : 0,
            borderColor: p.border,
            borderRadius: 14,
          }}
        >
          {inner}
        </View>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: p.muted, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.muted + '99'}
        {...props}
        style={[
          {
            backgroundColor: p.surface2,
            color: p.text,
            borderColor: p.border,
            borderWidth: 1,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
          },
          props.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null,
          props.style,
        ]}
      />
    </View>
  );
}

const STATUS_TONE: Record<string, keyof Palette> = {
  LIVE: 'success',
  COMPLETE: 'success',
  PASSED: 'success',
  ACCEPTED: 'success',
  SUCCEEDED: 'success',
  DONE: 'success',
  DRAFT: 'muted',
  PAUSED: 'warning',
  PENDING: 'warning',
  QUEUED: 'warning',
  RUNNING: 'accent3',
  CLOSED: 'muted',
  FAILED: 'danger',
  REJECTED: 'danger',
  ERROR: 'danger',
};

export function Pill({ label, tone }: { label: string; tone?: keyof Palette }) {
  const p = usePalette();
  const c = p[tone ?? STATUS_TONE[label.toUpperCase()] ?? 'accent'] as string;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: c + '26',
        borderColor: c + '66',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: c, fontSize: 12, fontWeight: '700' }}>{label.replace(/_/g, ' ').toLowerCase()}</Text>
    </View>
  );
}

/** A tappable list row with an icon, title, subtitle and optional trailing content. */
export function Row({
  title,
  subtitle,
  icon,
  right,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const p = usePalette();
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
      {icon ? (
        <View style={{ backgroundColor: p.accent + '22', borderRadius: 12, padding: 8 }}>
          <Ionicons name={icon} size={18} color={p.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: p.muted, fontSize: 13 }} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={p.muted} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {content}
    </Pressable>
  );
}

export function Divider() {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />;
}

export function List<T>({ items, render, empty }: { items: T[] | undefined; render: (item: T, i: number) => ReactNode; empty: string }) {
  if (!items?.length) return <Empty text={empty} />;
  return (
    <Card style={{ paddingVertical: 4, gap: 0 }}>
      {items.map((it, i) => (
        <View key={i}>
          {i > 0 ? <Divider /> : null}
          {render(it, i)}
        </View>
      ))}
    </Card>
  );
}

export function Empty({ text, icon = 'sparkles-outline' }: { text: string; icon?: IconName }) {
  const p = usePalette();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Ionicons name={icon} size={28} color={p.accent3} />
      <Text style={{ color: p.muted, textAlign: 'center' }}>{text}</Text>
    </Card>
  );
}

export function Loading() {
  const p = usePalette();
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator color={p.accent} />
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const p = usePalette();
  return (
    <Card style={{ borderColor: p.danger + '88' }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Ionicons name="alert-circle" size={18} color={p.danger} />
        <Text style={{ color: p.text, flex: 1 }} accessibilityRole="alert">
          {message}
        </Text>
      </View>
      {onRetry ? <Button title="Try again" kind="secondary" small onPress={onRetry} /> : null}
    </Card>
  );
}

/** Loading / error / content switch for a useApi result. */
export function Async<T>({
  q,
  children,
}: {
  q: { data: T | undefined; error: { message: string } | null; loading: boolean; reload: () => void };
  children: (d: T) => ReactNode;
}) {
  if (q.error && q.data === undefined) return <ErrorNote message={q.error.message} onRetry={q.reload} />;
  if (q.data === undefined) return <Loading />;
  return <>{children(q.data)}</>;
}

export function Segmented<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: Array<{ key: K; label: string }>;
  onChange: (k: K) => void;
}) {
  const p = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: on ? p.accent : p.surface,
              borderWidth: 1,
              borderColor: on ? p.accent : p.border,
            }}
          >
            <Text style={{ color: on ? p.onAccent : p.text, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: p.muted }}>{k}</Text>
      {typeof v === 'string' || typeof v === 'number' ? (
        <Text style={{ color: p.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{v}</Text>
      ) : (
        v
      )}
    </View>
  );
}

export function Bar({ label, value, max, color }: { label: string; value: number; max: number; color?: string }) {
  const p = usePalette();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: p.text, flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ color: p.muted, fontVariant: ['tabular-nums'] }}>{value.toLocaleString()}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: p.surface2, borderRadius: 99, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color ?? p.accent, borderRadius: 99 }} />
      </View>
    </View>
  );
}

export const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Scrollable body of a survey section (the survey screen supplies the backdrop and tabs). */
export function Section({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom, gap: 14 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.accent} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
