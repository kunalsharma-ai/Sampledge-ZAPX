import { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEntitlements } from '@/lib/entitlements-context';
import { FEATURES, type FeatureKey } from '@/lib/features';
import { usePalette } from '@/lib/theme';
import { Button, Card, Loading, Screen } from './ui';

/**
 * Shows its children only while every listed feature is on for this member's mobile subscription.
 * When the super admin removes a feature the screen switches to this notice at once (the stream or
 * the next poll pushes the change), and the API refuses its calls with 403 FEATURE_DISABLED anyway.
 */
export function Gate({ feature, children }: { feature: FeatureKey | FeatureKey[]; children: ReactNode }) {
  const { has, loaded, value } = useEntitlements();
  const keys = Array.isArray(feature) ? feature : [feature];
  if (!loaded) return <Loading />;
  const missing = keys.filter((k) => !has(k));
  if (!missing.length) return <>{children}</>;
  return <NotInPlan feature={missing[0]} suspended={value.suspended} mobileOff={value.surfaceAllowed === false} />;
}

/** Render `children` only while the feature is on (for buttons and menu entries). */
export function IfFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  return useEntitlements().has(feature) ? <>{children}</> : null;
}

export function NotInPlan({ feature, suspended, mobileOff }: { feature: FeatureKey; suspended?: boolean; mobileOff?: boolean }) {
  const p = usePalette();
  return (
    <Screen>
      <Card glow style={{ alignItems: 'center', paddingVertical: 32 }}>
        <Ionicons name={suspended ? 'pause-circle-outline' : 'lock-closed-outline'} size={36} color={p.accent2} />
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
          {suspended
            ? 'Organization suspended'
            : mobileOff
              ? 'The mobile app is turned off for you'
              : `${FEATURES[feature].label} is not in your mobile plan`}
        </Text>
        <Text style={{ color: p.muted, textAlign: 'center' }}>
          {suspended
            ? 'The platform administrator has suspended this organization. Contact them to restore access.'
            : mobileOff
              ? 'The platform administrator has not given you access to the mobile app. Use SampCode on the web, or ask them to turn it on.'
              : 'Your platform administrator controls which features each subscription includes. Ask them to turn it on; it appears here as soon as they do.'}
        </Text>
        <View style={{ marginTop: 8 }}>
          <Button title="Back to home" kind="secondary" icon="home-outline" onPress={() => router.replace('/')} />
        </View>
      </Card>
    </Screen>
  );
}

/** Banner announcing a change the super admin just made. */
export function EntitlementBanner() {
  const { notice } = useEntitlements();
  const p = usePalette();
  if (!notice) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        top: 8,
        left: 12,
        right: 12,
        zIndex: 50,
        backgroundColor: p.surface2,
        borderColor: p.accent3,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <Ionicons name="flash-outline" size={18} color={p.accent3} />
      <Text style={{ color: p.text, flex: 1 }}>{notice}</Text>
    </View>
  );
}
