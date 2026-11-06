import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HELP, type HelpKey } from '@/lib/help';
import { usePalette } from '@/lib/theme';

/**
 * The neon "i" next to a heading or section. Tapping it opens a card that explains what the
 * feature is for, how to use it and where to use it (text in lib/help.ts). Tap outside or "Got it"
 * to close.
 */
export function InfoButton({ k, label }: { k: HelpKey; label?: string }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const e = HELP[k];
  const rows: Array<[string, string, string | string[]]> = [
    ['locate-outline', 'What it is for', e.what],
    ['construct-outline', 'How to use it', e.how],
    ['map-outline', 'Where and when to use it', e.where],
  ];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Help"
        accessibilityHint={`About ${e.title}`}
        hitSlop={10}
        onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <Ionicons name="information-circle-outline" size={20} color={p.accent3} />
        {label ? <Text style={{ color: p.accent3, fontSize: 13, fontWeight: '600' }}>{label}</Text> : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(5,3,20,0.6)', justifyContent: 'center', padding: 20 }}
        >
          <Pressable
            onPress={() => undefined}
            style={{
              maxHeight: '80%',
              borderRadius: 20,
              borderWidth: 1,
              borderColor: p.edge,
              backgroundColor: p.surface,
              padding: 18,
              shadowColor: p.accent,
              shadowOpacity: 0.5,
              shadowRadius: 24,
            }}
          >
            <ScrollView contentContainerStyle={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="information-circle" size={22} color={p.accent3} />
                <Text accessibilityRole="header" style={{ color: p.text, fontSize: 18, fontWeight: '800', flex: 1 }}>
                  {e.title}
                </Text>
              </View>
              {rows.map(([icon, head, body]) => (
                <View key={head} style={{ flexDirection: 'row', gap: 10 }}>
                  <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={p.accent} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: p.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                      {head}
                    </Text>
                    {(Array.isArray(body) ? body : [body]).map((line, i, all) => (
                      <Text key={line} style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>
                        {all.length > 1 ? `${i + 1}. ` : ''}
                        {line}
                      </Text>
                    ))}
                  </View>
                </View>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}
                style={{ alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: p.accent }}
              >
                <Text style={{ color: p.onAccent, fontWeight: '700' }}>Got it</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
