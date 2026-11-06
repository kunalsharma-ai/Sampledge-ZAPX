import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Button, Card, ErrorNote, Field, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import brandMark from '../../assets/images/splash-icon.png';
import { usePalette } from '@/lib/theme';

export default function Login() {
  const { member, server: saved, signIn, ready } = useSession();
  const p = usePalette();
  const [server, setServer] = useState(saved);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ready && member) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(server, email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ alignItems: 'center', gap: 10, marginTop: 48, marginBottom: 12 }}>
          <Image source={brandMark} style={{ width: 96, height: 96 }} accessibilityIgnoresInvertColors testID="brand-mark" />
          <Text style={{ color: p.text, fontSize: 32, fontWeight: '900' }} accessibilityRole="header">
            Samp<Text style={{ color: p.accent3 }}>Code</Text>
          </Text>
          <Text style={{ color: p.muted, fontWeight: '700', letterSpacing: 0.5 }}>Write. Run. Ship. · by Sampledge</Text>
          <Text style={{ color: p.muted, textAlign: 'center' }}>Build, program, test and launch surveys smarter with AI</Text>
        </View>
        <Card glow>
          <Field
            label="SampCode address"
            value={server}
            onChangeText={setServer}
            placeholder="sampcode.yourcompany.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="server"
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            testID="email"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            onSubmitEditing={submit}
            testID="password"
          />
          {error ? <ErrorNote message={error} /> : null}
          <Button
            title="Sign in"
            icon="log-in-outline"
            onPress={submit}
            busy={busy}
            disabled={!server || !email || !password}
            testID="sign-in"
          />
        </Card>
        <Text style={{ color: p.muted, textAlign: 'center', fontSize: 12 }}>
          Organizations that use single sign-on: sign in on the web first; mobile SSO is not available yet.
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}
