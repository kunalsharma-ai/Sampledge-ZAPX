import { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Gate } from '@/components/gate';
import { Screen, Segmented } from '@/components/ui';
import { InfoButton } from '@/components/info';
import { useApi } from '@/lib/use-api';
import { useEntitlements } from '@/lib/entitlements-context';
import type { FeatureKey } from '@/lib/features';
import type { SurveyDetail } from '@/lib/types';
import { Overview } from '@/screens/survey/overview';
import { Quotas } from '@/screens/survey/quotas';
import { Responses } from '@/screens/survey/responses';
import { Outline } from '@/screens/survey/outline';
import { QaLab } from '@/screens/survey/qa';
import { Review } from '@/screens/survey/review';
import { Fieldwork } from '@/screens/survey/fieldwork';
import { Analysis } from '@/screens/survey/analysis';
import { Reports } from '@/screens/survey/reports';
import { Exports } from '@/screens/survey/exports';
import { Distribution } from '@/screens/survey/distribution';
import { CatiSetup } from '@/screens/survey/cati';
import { Assist } from '@/screens/survey/assist';

/** Survey sections, each shown only while its feature is in the member's mobile plan. */
export const SECTIONS = [
  { key: 'overview', label: 'Overview', feature: 'surveys.view' },
  { key: 'quotas', label: 'Quotas', feature: 'surveys.view' },
  { key: 'responses', label: 'Responses', feature: 'surveys.view' },
  { key: 'outline', label: 'Questions', feature: 'surveys.view' },
  { key: 'assist', label: 'AI assist', feature: 'ai_assist' },
  { key: 'qa', label: 'QA', feature: 'qa' },
  { key: 'review', label: 'Review', feature: 'review_queue' },
  { key: 'fieldwork', label: 'Fieldwork', feature: 'fieldwork' },
  { key: 'analysis', label: 'Analysis', feature: 'analysis' },
  { key: 'reports', label: 'Reports', feature: 'reports' },
  { key: 'exports', label: 'Exports', feature: 'exports' },
  { key: 'distribution', label: 'Invitations', feature: 'distribution' },
  { key: 'cati', label: 'CATI', feature: 'cati' },
] as const satisfies ReadonlyArray<{ key: string; label: string; feature: FeatureKey }>;
type SectionKey = (typeof SECTIONS)[number]['key'];

export default function SurveyScreen() {
  return (
    <Gate feature="surveys.view">
      <SurveyBody />
    </Gate>
  );
}

function SurveyBody() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { has } = useEntitlements();
  const q = useApi<SurveyDetail>(`/surveys/${id}`);
  const visible = SECTIONS.filter((s) => has(s.feature));
  const [section, setSection] = useState<SectionKey>((visible.find((s) => s.key === tab)?.key ?? 'overview') as SectionKey);
  // If the super admin removes the open section's feature, fall back to the overview.
  useEffect(() => {
    if (!visible.some((s) => s.key === section)) setSection('overview');
  }, [visible, section]);

  const body = () => {
    switch (section) {
      case 'overview':
        return <Overview survey={q} />;
      case 'quotas':
        return <Quotas surveyId={id} />;
      case 'responses':
        return <Responses surveyId={id} />;
      case 'outline':
        return <Outline surveyId={id} />;
      case 'assist':
        return <Assist surveyId={id} />;
      case 'qa':
        return <QaLab surveyId={id} />;
      case 'review':
        return <Review surveyId={id} />;
      case 'fieldwork':
        return <Fieldwork surveyId={id} />;
      case 'analysis':
        return <Analysis surveyId={id} />;
      case 'reports':
        return <Reports surveyId={id} />;
      case 'exports':
        return <Exports surveyId={id} />;
      case 'distribution':
        return <Distribution surveyId={id} />;
      case 'cati':
        return <CatiSetup surveyId={id} />;
    }
  };

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ title: q.data?.name ?? 'Survey' }} />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <Segmented value={section} options={visible.map((s) => ({ key: s.key, label: s.label }))} onChange={setSection} />
        <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
          <InfoButton key={section} k={`section.${section}` as const} label="What is this section for?" />
        </View>
      </View>
      <View style={{ flex: 1 }}>{body()}</View>
    </Screen>
  );
}
