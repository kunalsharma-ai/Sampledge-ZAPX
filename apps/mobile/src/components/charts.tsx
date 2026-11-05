import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { usePalette } from '@/lib/theme';

/** Two-series area/line chart (starts vs completes per day). */
export function TrendChart({ points }: { points: Array<{ date: string; starts: number; completes: number }> }) {
  const p = usePalette();
  const [w, setW] = useState(300);
  const h = 140;
  const max = Math.max(1, ...points.map((d) => Math.max(d.starts, d.completes)));
  const x = (i: number) => (points.length <= 1 ? 0 : (i / (points.length - 1)) * w);
  const y = (v: number) => h - 8 - (v / max) * (h - 16);
  const line = (k: 'starts' | 'completes') => points.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const area = (k: 'starts' | 'completes') => `${line(k)} L${w},${h} L0,${h} Z`;
  const total = (k: 'starts' | 'completes') => points.reduce((s, d) => s + d[k], 0);
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Last ${points.length} days: ${total('starts')} starts, ${total('completes')} completes`}
    >
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id="gs" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.viz[1]} stopOpacity={0.45} />
            <Stop offset="1" stopColor={p.viz[1]} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.viz[0]} stopOpacity={0.4} />
            <Stop offset="1" stopColor={p.viz[0]} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {points.length > 1 ? (
          <>
            <Path d={area('starts')} fill="url(#gs)" />
            <Path d={line('starts')} stroke={p.viz[1]} strokeWidth={2} fill="none" />
            <Path d={area('completes')} fill="url(#gc)" />
            <Path d={line('completes')} stroke={p.viz[0]} strokeWidth={2} fill="none" />
          </>
        ) : null}
      </Svg>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
        <Legend color={p.viz[1]} label={`Starts ${total('starts').toLocaleString()}`} />
        <Legend color={p.viz[0]} label={`Completes ${total('completes').toLocaleString()}`} />
      </View>
    </View>
  );
}

export function Legend({ color, label }: { color: string; label: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color: p.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** Donut with a centre total; slices in order of the palette's chart colours. */
export function Donut({ slices, size = 140, center }: { slices: Array<{ label: string; value: number }>; size?: number; center?: string }) {
  const p = usePalette();
  const colors = [...p.viz, p.muted];
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={p.surface2} strokeWidth={14} fill="none" />
          {total > 0
            ? slices.map((s, i) => {
                const len = (s.value / total) * c;
                const el = (
                  <Circle
                    key={s.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={colors[i % colors.length]}
                    strokeWidth={14}
                    fill="none"
                    strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += len;
                return el;
              })
            : null}
        </Svg>
        <Text style={{ color: p.text, fontSize: 20, fontWeight: '800' }}>{center ?? total.toLocaleString()}</Text>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        {slices.map((s, i) => (
          <View key={s.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Legend color={colors[i % colors.length]} label={s.label} />
            <Text style={{ color: p.text, fontWeight: '600' }}>{total ? Math.round((s.value / total) * 100) : 0}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
