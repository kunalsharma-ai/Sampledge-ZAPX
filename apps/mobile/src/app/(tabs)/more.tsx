import { View } from 'react-native';
import { Launcher } from '@/components/launcher';
import { Button, Card, KV, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useEntitlements } from '@/lib/entitlements-context';

export default function More() {
  const { member, server, signOut } = useSession();
  const { value } = useEntitlements();
  const on = Object.values(value.features).filter(Boolean).length;
  return (
    <Screen>
      <Card glow>
        <KV k="Signed in as" v={member?.name || member?.email || ''} />
        <KV k="Organization" v={member?.tenant?.name ?? '—'} />
        <KV k="Role" v={(member?.role ?? '').toLowerCase()} />
        <KV k="Mobile plan" v={value.suspended ? 'suspended' : `${value.plan ?? '—'} · ${on} features`} />
        <KV k="Server" v={server.replace(/^https?:\/\//, '')} />
      </Card>
      <Launcher exclude={['notifications']} />
      <View style={{ marginTop: 8 }}>
        <Button title="Sign out" kind="secondary" icon="log-out-outline" onPress={() => void signOut()} testID="sign-out" />
      </View>
    </Screen>
  );
}
