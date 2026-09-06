import type { EnrichmentResult } from '../server/types.js';

export const permissionsResult: EnrichmentResult = {
  status: 'available',
  data: [{ permission: 'read your contacts', type: 'Contacts' }],
  raw: {
    permissions: [{ permission: 'read your contacts', type: 'Contacts' }],
    unknownPermissionMetadata: { providerVersion: 'fixture-v1', untranslatedLabel: 'รายชื่อ' },
  },
  source: 'https://play.google.com/store/apps/details?id=fixture.evidence.loan',
  requestCountry: 'th',
  requestLanguage: 'th',
  note: 'Store-declared sample only, not installed application runtime permissions.',
};

export const dataSafetyResult: EnrichmentResult = {
  status: 'available',
  data: {
    sharedData: [{ category: 'Personal information', purposes: ['App functionality'] }],
    collectedData: [{ category: 'Device identifiers' }],
    securityPractices: ['Data encrypted in transit'],
  },
  raw: {
    unknownFuturePolicyField: ['preserve', { nested: true }],
    providerDeclaredData: { links: [{ label: 'Policy', url: 'https://example.invalid/policy' }] },
  },
  source: 'https://play.google.com/store/apps/datasafety?id=fixture.evidence.loan',
  requestCountry: 'th',
  requestLanguage: 'th',
  note: 'Developer declaration, not independently verified collection behavior.',
};

export const applePrivacyResult: EnrichmentResult = {
  status: 'available',
  data: {
    privacyTypes: [
      { identifier: 'DATA_LINKED_TO_YOU', dataCategories: [{ dataCategory: 'Contact Info' }] },
    ],
  },
  raw: {
    privacyDetails: { privacyTypes: [{ identifier: 'DATA_LINKED_TO_YOU' }] },
    futureUnknownNested: { labels: ['ข้อมูล', 'privacidad'] },
  },
  source: 'https://apps.apple.com/th/app/id123456',
  requestCountry: 'th',
  requestLanguage: null,
  note: 'Apple store privacy label; language and actual runtime permissions are not inferred.',
};
