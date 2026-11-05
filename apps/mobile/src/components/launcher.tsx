import { router, type Href } from 'expo-router';
import { Text, View } from 'react-native';
import { useEntitlements } from '@/lib/entitlements-context';
import { FEATURES, type FeatureKey } from '@/lib/features';
import { usePalette } from '@/lib/theme';
import { useSession } from '@/lib/session';
import { Card, Divider, Row, type IconName } from './ui';

/** Screens reachable from the menu. Survey-level features (QA, analysis…) live inside a survey. */
export const MENU: Array<{ feature: FeatureKey; href: Href; icon: IconName }> = [
  { feature: 'projects', href: '/projects', icon: 'folder-open-outline' },
  { feature: 'cati', href: '/calls', icon: 'call-outline' },
  { feature: 'capi', href: '/capi', icon: 'tablet-portrait-outline' },
  { feature: 'notifications', href: '/inbox', icon: 'notifications-outline' },
  { feature: 'automation', href: '/automation', icon: 'git-network-outline' },
  { feature: 'library', href: '/library', icon: 'library-outline' },
  { feature: 'team', href: '/team', icon: 'people-circle-outline' },
  { feature: 'audit_log', href: '/audit', icon: 'receipt-outline' },
  { feature: 'settings', href: '/organization', icon: 'business-outline' },
];

export function Launcher({ exclude = [] }: { exclude?: FeatureKey[] }) {
  const { has } = useEntitlements();
  const { member } = useSession();
  const p = usePalette();
  const items = MENU.filter((m) => has(m.feature) && !exclude.includes(m.feature));
  const groups = ['Work', 'Fieldwork', 'Insights', 'Organization'] as const;
  return (
    <View style={{ gap: 14 }}>
      {groups.map((g) => {
        const list = items.filter((m) => FEATURES[m.feature].group === g);
        if (!list.length) return null;
        return (
          <View key={g} style={{ gap: 8 }}>
            <Text style={{ color: p.muted, fontWeight: '700', fontSize: 12, letterSpacing: 1 }}>{g.toUpperCase()}</Text>
            <Card style={{ paddingVertical: 2, gap: 0 }}>
              {list.map((m, i) => (
                <View key={m.feature}>
                  {i > 0 ? <Divider /> : null}
                  <Row
                    testID={`menu-${m.feature}`}
                    title={FEATURES[m.feature].label}
                    subtitle={FEATURES[m.feature].blurb}
                    icon={m.icon}
                    onPress={() => router.push(m.href)}
                  />
                </View>
              ))}
            </Card>
          </View>
        );
      })}
      <View style={{ gap: 8 }}>
        <Text style={{ color: p.muted, fontWeight: '700', fontSize: 12, letterSpacing: 1 }}>YOU</Text>
        <Card style={{ paddingVertical: 2, gap: 0 }}>
          <Row
            testID="menu-account"
            title="Account"
            subtitle="Password, theme and sign-out"
            icon="person-circle-outline"
            onPress={() => router.push('/account')}
          />
          {member?.canManageIntegrations || member?.superAdmin ? (
            <>
              <Divider />
              <Row
                testID="menu-platform"
                title="Platform integrations"
                subtitle="Claude, IPinfo, Deepgram, Twilio, Stripe, S3 status"
                icon="extension-puzzle-outline"
                onPress={() => router.push('/platform')}
              />
            </>
          ) : null}
        </Card>
      </View>
    </View>
  );
}
