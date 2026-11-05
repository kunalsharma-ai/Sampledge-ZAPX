import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '@/lib/session';
import { useEntitlements } from '@/lib/entitlements-context';
import { usePalette } from '@/lib/theme';
import { Loading } from '@/components/ui';

/**
 * Bottom tabs. A tab exists only while one of its features is on, so when the super admin removes a
 * feature from the mobile subscription its tab disappears without the member restarting the app.
 */
export default function TabsLayout() {
  const { ready, member } = useSession();
  const { has, loaded } = useEntitlements();
  const p = usePalette();
  if (!ready) return <Loading />;
  if (!member) return <Redirect href="/login" />;
  const show = (on: boolean) => (on || !loaded ? undefined : null);
  const icon =
    (name: keyof typeof Ionicons.glyphMap) =>
    ({ color, size }: { color: unknown; size: number }) => (
      <Ionicons name={name} color={typeof color === 'string' ? color : undefined} size={size} />
    );
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: p.bg },
        headerTintColor: p.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800' },
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border },
        tabBarActiveTintColor: p.accent3,
        tabBarInactiveTintColor: p.muted,
        sceneStyle: { backgroundColor: p.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('grid-outline'), href: show(has('dashboard')) }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: icon('folder-open-outline'), href: show(has('projects')) }} />
      <Tabs.Screen
        name="field"
        options={{
          title: 'Fieldwork',
          tabBarIcon: icon('people-outline'),
          href: show(has('cati') || has('capi') || has('fieldwork') || has('review_queue')),
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: icon('notifications-outline'), href: show(has('notifications')) }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('menu-outline') }} />
    </Tabs>
  );
}
