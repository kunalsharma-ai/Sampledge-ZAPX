/**
 * Built-in survey templates (blueprint phase 1). Each is an ordinary, complete survey definition
 * that passes the logic check, so a new survey can start from it and be edited like any other.
 * Organizations add their own templates in the question bank.
 */
import type { SurveyDefinitionInput } from './index.js';

export interface SurveyTemplate {
  key: string;
  name: string;
  category: 'Customer' | 'Brand' | 'Product' | 'Healthcare' | 'Employee' | 'UX';
  description: string;
  /** Methods the template shows off, for the template picker. */
  features: string[];
  definition: SurveyDefinitionInput;
}

const agree5 = [
  { code: 1, label: 'Strongly disagree' },
  { code: 2, label: 'Disagree' },
  { code: 3, label: 'Neither agree nor disagree' },
  { code: 4, label: 'Agree' },
  { code: 5, label: 'Strongly agree' },
];
const ages = [
  { code: 1, label: '18-34' },
  { code: 2, label: '35-54' },
  { code: 3, label: '55 or older' },
];
const genders = [
  { code: 1, label: 'Woman' },
  { code: 2, label: 'Man' },
  { code: 3, label: 'Another way' },
  { code: 9, label: 'Prefer not to say' },
];

export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    key: 'customer-nps',
    name: 'Customer satisfaction & NPS',
    category: 'Customer',
    description: 'Net Promoter Score with a follow-up for detractors and promoters, satisfaction drivers and an open comment.',
    features: ['NPS', 'Rating grid', 'Conditional follow-ups', 'Calculated segment'],
    definition: {
      schemaVersion: 1,
      title: 'Customer satisfaction & NPS',
      welcome: 'Thank you for helping us improve. This takes about 3 minutes.',
      thankYou: 'Thank you, your feedback has been recorded.',
      pages: [
        {
          id: 'P1',
          questions: [
            {
              id: 'NPS',
              type: 'scale',
              text: 'How likely are you to recommend us to a friend or colleague?',
              nps: true,
              minLabel: 'Not at all likely',
              maxLabel: 'Extremely likely',
            },
          ],
        },
        {
          id: 'P2',
          questions: [
            { id: 'WHY_LOW', type: 'open', text: 'What is the main thing we should do better?', multiline: true, condition: 'NPS <= 6' },
            { id: 'WHY_HIGH', type: 'open', text: 'What do you value most about us?', multiline: true, condition: 'NPS >= 9' },
            {
              id: 'SAT',
              type: 'grid',
              text: 'How much do you agree with each statement?',
              rows: [
                { id: 'r1', label: 'The product does what I need' },
                { id: 'r2', label: 'Support solves my problems quickly' },
                { id: 'r3', label: 'It is good value for money' },
              ],
              columns: agree5,
              randomizeRows: true,
            },
          ],
        },
        {
          id: 'P3',
          questions: [{ id: 'COMMENT', type: 'open', text: 'Anything else you would like to tell us?', required: false, multiline: true }],
        },
      ],
      variables: [{ id: 'PROMOTER', label: 'Promoter (9-10)', expr: 'NPS >= 9' }],
    },
  },
  {
    key: 'brand-health',
    name: 'Brand health tracker',
    category: 'Brand',
    description: 'Awareness, then a loop that rates every brand the respondent knows, with age and gender quotas.',
    features: ['Loop over chosen brands', 'Dynamic answer list', 'Interlocking quotas', 'Termination'],
    definition: {
      schemaVersion: 1,
      title: 'Brand health tracker',
      pages: [
        {
          id: 'S1',
          title: 'About you',
          questions: [
            { id: 'AGE', type: 'single', text: 'How old are you?', options: [{ code: 0, label: 'Under 18' }, ...ages] },
            { id: 'GENDER', type: 'single', text: 'How do you describe yourself?', options: genders },
          ],
        },
        {
          id: 'A1',
          questions: [
            {
              id: 'AWARE',
              type: 'multi',
              text: 'Which of these brands have you heard of?',
              options: [
                { code: 1, label: 'Northwind' },
                { code: 2, label: 'Contoso' },
                { code: 3, label: 'Fabrikam' },
                { code: 4, label: 'Tailspin' },
                { code: 99, label: 'None of these', exclusive: true, anchor: true },
              ],
              randomize: true,
            },
          ],
        },
        {
          id: 'L1',
          title: 'About {{BRAND}}',
          questions: [
            {
              id: 'RATING',
              type: 'scale',
              text: 'Overall, how would you rate {{BRAND}}?',
              min: 1,
              max: 10,
              minLabel: 'Very poor',
              maxLabel: 'Excellent',
            },
            {
              id: 'CONSIDER',
              type: 'single',
              text: 'How likely are you to buy {{BRAND}} next time?',
              options: [
                { code: 1, label: 'Definitely not' },
                { code: 2, label: 'Probably not' },
                { code: 3, label: 'Probably' },
                { code: 4, label: 'Definitely' },
              ],
            },
          ],
        },
        {
          id: 'P1',
          questions: [
            {
              id: 'PREFER',
              type: 'single',
              text: 'And which one do you prefer?',
              options: [
                { code: 1, label: 'Northwind' },
                { code: 2, label: 'Contoso' },
                { code: 3, label: 'Fabrikam' },
                { code: 4, label: 'Tailspin' },
              ],
              optionsFrom: { question: 'AWARE' },
            },
          ],
        },
      ],
      loops: [{ id: 'BRAND', pages: ['L1'], source: 'AWARE' }],
      terminations: [
        { id: 'T_MINOR', condition: 'AGE == 0', status: 'terminate', label: 'Under 18' },
        { id: 'T_UNAWARE', condition: 'selected(AWARE, 99)', status: 'terminate', label: 'Knows none of the brands' },
      ],
      quotas: [
        { id: 'QT_AGE1', label: '18-34', condition: 'AGE == 1', target: 100 },
        { id: 'QT_AGE2', label: '35-54', condition: 'AGE == 2', target: 100 },
        { id: 'QT_AGE3', label: '55+', condition: 'AGE == 3', target: 100 },
      ],
    },
  },
  {
    key: 'concept-test',
    name: 'Concept test (monadic rotation)',
    category: 'Product',
    description: 'Each respondent sees two of three concepts in a random order; purchase intent, appeal and a final preference.',
    features: ['Randomized block', 'Pick 2 of 3', 'Rating scales', 'Ranking'],
    definition: {
      schemaVersion: 1,
      title: 'Concept test',
      pages: [
        ...(['A', 'B', 'C'] as const).map((c) => ({
          id: `C_${c}`,
          title: `Concept ${c}`,
          questions: [
            {
              id: `INFO_${c}`,
              type: 'info' as const,
              text: `Please read concept ${c} carefully. (Add the concept picture or video here.)`,
            },
            {
              id: `APPEAL_${c}`,
              type: 'scale' as const,
              text: `How appealing is concept ${c}?`,
              min: 1,
              max: 5,
              minLabel: 'Not at all',
              maxLabel: 'Extremely',
            },
            {
              id: `PI_${c}`,
              type: 'single' as const,
              text: `How likely would you be to buy concept ${c}?`,
              options: [
                { code: 1, label: 'Definitely would not' },
                { code: 2, label: 'Probably would not' },
                { code: 3, label: 'Might or might not' },
                { code: 4, label: 'Probably would' },
                { code: 5, label: 'Definitely would' },
              ],
            },
          ],
        })),
        {
          id: 'END',
          questions: [
            {
              id: 'RANK',
              type: 'ranking',
              text: 'Put these ideas in order of preference.',
              options: [
                { code: 1, label: 'Concept A' },
                { code: 2, label: 'Concept B' },
                { code: 3, label: 'Concept C' },
              ],
              randomize: true,
            },
          ],
        },
      ],
      blocks: [{ id: 'CONCEPTS', pages: ['C_A', 'C_B', 'C_C'], randomize: true, pick: 2 }],
    },
  },
  {
    key: 'hcp-screener',
    name: 'Healthcare professional screener',
    category: 'Healthcare',
    description: 'Specialty, practice and patient load screening with terminations and specialty quotas.',
    features: ['Screening logic', 'Numeric ranges', 'Quotas', 'Calculated variable'],
    definition: {
      schemaVersion: 1,
      title: 'HCP screener',
      pages: [
        {
          id: 'S1',
          questions: [
            {
              id: 'SPEC',
              type: 'single',
              text: 'What is your primary specialty?',
              options: [
                { code: 1, label: 'Cardiology' },
                { code: 2, label: 'Oncology' },
                { code: 3, label: 'General practice' },
                { code: 98, label: 'Other', anchor: true },
              ],
            },
            {
              id: 'YEARS',
              type: 'numeric',
              text: 'How many years have you been in practice since completing training?',
              min: 0,
              max: 60,
              unit: 'years',
            },
          ],
        },
        {
          id: 'S2',
          questions: [
            {
              id: 'PATIENTS',
              type: 'numeric',
              text: 'How many patients do you see in a typical month?',
              min: 0,
              max: 5000,
              unit: 'patients',
            },
            {
              id: 'SETTING',
              type: 'multi',
              text: 'Where do you see patients?',
              options: [
                { code: 1, label: 'Hospital' },
                { code: 2, label: 'Private practice' },
                { code: 3, label: 'Community clinic' },
              ],
            },
          ],
        },
      ],
      variables: [{ id: 'HIGH_VOLUME', label: 'Sees 200+ patients a month', expr: 'PATIENTS >= 200' }],
      terminations: [
        { id: 'T_SPEC', condition: 'SPEC == 98', status: 'terminate', label: 'Not a target specialty' },
        { id: 'T_YEARS', condition: 'YEARS < 3 or YEARS > 35', status: 'terminate', label: 'Outside 3-35 years in practice' },
        { id: 'T_VOLUME', condition: 'PATIENTS < 50', status: 'terminate', label: 'Fewer than 50 patients a month' },
      ],
      quotas: [
        { id: 'QT_CARDIO', label: 'Cardiology', condition: 'SPEC == 1', target: 50 },
        { id: 'QT_ONCO', label: 'Oncology', condition: 'SPEC == 2', target: 50 },
        { id: 'QT_GP', label: 'General practice', condition: 'SPEC == 3', target: 100 },
      ],
    },
  },
  {
    key: 'employee-engagement',
    name: 'Employee engagement',
    category: 'Employee',
    description: 'Engagement statements, employee NPS and open feedback, with an engagement index.',
    features: ['Agreement grid', 'eNPS', 'Calculated index'],
    definition: {
      schemaVersion: 1,
      title: 'Employee engagement',
      welcome: 'Your answers are confidential and reported only for groups of 5 or more people.',
      pages: [
        {
          id: 'P1',
          questions: [
            {
              id: 'ENG',
              type: 'grid',
              text: 'How much do you agree with each statement?',
              rows: [
                { id: 'proud', label: 'I am proud to work here' },
                { id: 'grow', label: 'I have opportunities to learn and grow' },
                { id: 'valued', label: 'My work is valued' },
                { id: 'stay', label: 'I see myself working here in two years' },
              ],
              columns: agree5,
              randomizeRows: true,
            },
          ],
        },
        {
          id: 'P2',
          questions: [{ id: 'ENPS', type: 'scale', text: 'How likely are you to recommend this company as a place to work?', nps: true }],
        },
        {
          id: 'P3',
          questions: [
            {
              id: 'IMPROVE',
              type: 'open',
              text: 'What one change would make the biggest difference for you?',
              multiline: true,
              required: false,
            },
          ],
        },
      ],
      variables: [
        { id: 'ENG_INDEX', label: 'Engagement index (1-5)', expr: 'round((ENG.proud + ENG.grow + ENG.valued + ENG.stay) / 4, 2)' },
      ],
    },
  },
  {
    key: 'ux-card-sort',
    name: 'Information architecture card sort',
    category: 'UX',
    description: 'A closed card sort to test where people expect to find content, with a confidence follow-up.',
    features: ['Card sort', 'Rating scale'],
    definition: {
      schemaVersion: 1,
      title: 'Navigation card sort',
      pages: [
        {
          id: 'P1',
          questions: [
            {
              id: 'SORT',
              type: 'cardsort',
              text: 'Put each item into the menu where you would look for it.',
              options: [
                { code: 1, label: 'Change my password' },
                { code: 2, label: 'Download an invoice' },
                { code: 3, label: 'Invite a colleague' },
                { code: 4, label: 'Contact support' },
                { code: 5, label: 'Update payment card' },
                { code: 6, label: 'Read the release notes' },
              ],
              groups: [
                { code: 1, label: 'Account' },
                { code: 2, label: 'Billing' },
                { code: 3, label: 'Team' },
                { code: 4, label: 'Help' },
              ],
            },
          ],
        },
        {
          id: 'P2',
          questions: [
            {
              id: 'CONF',
              type: 'scale',
              text: 'How confident are you in your choices?',
              min: 1,
              max: 5,
              minLabel: 'Not at all',
              maxLabel: 'Very',
            },
          ],
        },
      ],
    },
  },
];

export function surveyTemplate(key: string): SurveyTemplate | undefined {
  return SURVEY_TEMPLATES.find((t) => t.key === key);
}
