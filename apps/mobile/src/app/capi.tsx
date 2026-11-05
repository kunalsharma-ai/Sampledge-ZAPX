import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { Gate } from '@/components/gate';
import { Async, Button, Card, Screen, T } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { usePalette } from '@/lib/theme';

/**
 * Face-to-face (CAPI) interviewing. The ZAPX CAPI app is an offline-first web app (it keeps
 * interviews on the device and syncs later), so the mobile app hosts it in a WebView with camera,
 * microphone and location allowed, rather than duplicating the interview engine natively.
 */
export default function Capi() {
  return (
    <>
      <Stack.Screen options={{ title: 'Face-to-face interviews' }} />
      <Gate feature="capi">
        <CapiHost />
      </Gate>
    </>
  );
}

function CapiHost() {
  const cfg = useApi<{ capiAppUrl: string }>('/mobile/config');
  const p = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <Async q={cfg}>
      {(c) =>
        open && Platform.OS !== 'web' ? (
          <View style={{ flex: 1, backgroundColor: p.bg }}>
            <WebView
              source={{ uri: c.capiAppUrl }}
              style={{ flex: 1, backgroundColor: p.bg }}
              originWhitelist={[new URL(c.capiAppUrl).origin + '*']}
              geolocationEnabled
              mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
              allowsInlineMediaPlayback
              domStorageEnabled
              cacheEnabled
              javaScriptEnabled
            />
          </View>
        ) : (
          <Screen>
            <Card glow>
              <T bold size={18}>
                Offline interviewing
              </T>
              <T muted>
                Sign in with your interviewer account inside the CAPI app, download your surveys while online, and interview anywhere.
                Interviews stay on this device until they sync.
              </T>
              <Button
                title="Open the CAPI app"
                icon="tablet-portrait-outline"
                onPress={() => (Platform.OS === 'web' ? void WebBrowser.openBrowserAsync(c.capiAppUrl) : setOpen(true))}
                testID="open-capi"
              />
            </Card>
          </Screen>
        )
      }
    </Async>
  );
}
