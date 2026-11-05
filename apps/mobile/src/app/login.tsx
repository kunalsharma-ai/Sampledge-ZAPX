import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, ErrorNote, Field, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
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
          <View style={{ backgroundColor: p.accent + '33', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: p.edge }}>
            <Ionicons name="flash" size={36} color={p.accent3} />
          </View>
          <Text style={{ color: p.text, fontSize: 30, fontWeight: '900', letterSpacing: 1 }}>ZAPX</Text>
          <Text style={{ color: p.muted, textAlign: 'center' }}>Build, program, test and launch surveys smarter with AI</Text>
        </View>
        <Card glow>
          <Field
            label="ZAPX address"
            value={server}
            onChangeText={setServer}
            placeholder="zapx.yourcompany.com"
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
