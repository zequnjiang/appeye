import type { LoanAnalysis } from './loan-identification.js';
export type StoreName = 'google-play' | 'app-store';
export type Classification = 'candidate' | 'confirmed' | 'excluded';
export interface Country {
  code: string;
  name: string;
  language: string;
  keywords: string[];
  enabled: boolean;
  intervalHours: number;
  lastDiscoveryAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface NormalizedApp {
  externalId: string;
  title: string;
  developer?: string | null;
  icon?: string | null;
  url?: string | null;
  summary?: string | null;
  description?: string | null;
  version?: string | null;
  score?: number | null;
  ratings?: number | null;
  installs?: string | null;
  minInstalls?: number | null;
  maxInstalls?: number | null;
  releaseNotes?: string | null;
  releasedAt?: string | null;
  storeUpdatedAt?: string | null;
  bundleId?: string | null;
  reviewCount?: number | null;
  price?: number | null;
  currency?: string | null;
  genre?: string | null;
  developerWebsite?: string | null;
  privacyPolicy?: string | null;
  developerId?: string | null;
  developerUrl?: string | null;
  developerEmail?: string | null;
  developerAddress?: string | null;
  developerLegalName?: string | null;
  developerLegalEmail?: string | null;
  developerLegalAddress?: string | null;
  developerLegalPhoneNumber?: string | null;
  sellerName?: string | null;
  sellerUrl?: string | null;
  screenshots?: string[] | null;
  storeData?: Record<string, unknown> | null;
  raw?: unknown;
}
export interface AppRecord extends NormalizedApp {
  id: number;
  store: StoreName;
  country: string;
  classification: Classification;
  effectiveClassification: Classification;
  classificationSource: 'auto' | 'manual' | 'legacy';
  manualOverride: boolean;
  loanAnalysis: LoanAnalysis | null;
  sourceKeyword: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  updateCount: number;
  observedUpdateIntervalDays: number | null;
}
export interface DiscoveredApp extends NormalizedApp {}
export interface NormalizedReview {
  externalId: string;
  userName?: string | null;
  title?: string | null;
  text: string;
  score?: number | null;
  version?: string | null;
  reviewedAt?: string | null;
  replyText?: string | null;
  language?: string | null;
  raw?: unknown;
}
export interface Review extends NormalizedReview {
  id: number;
  appId: number;
  country: string;
  fetchedAt: string;
}
export interface Snapshot {
  id: number;
  appId: number;
  observedAt: string;
  data: NormalizedApp;
  raw: unknown;
}
export interface Change {
  id: number;
  snapshotId: number | null;
  appId: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  observedAt: string;
  title: string;
  store: StoreName;
  country: string;
}
export type JobType = 'discover' | 'refresh' | 'reviews' | 'enrich';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export interface Job {
  id: number;
  type: JobType;
  status: JobStatus;
  country: string;
  store: StoreName;
  appId: number | null;
  attempts: number;
  maxAttempts: number;
  progress: string | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string;
}
export interface ProviderContext {
  country: string;
  language: string;
  signal?: AbortSignal;
}
export interface Provider {
  search(input: ProviderContext & { keyword: string }): Promise<DiscoveredApp[]>;
  app(input: ProviderContext & { externalId: string }): Promise<NormalizedApp>;
  reviews(input: ProviderContext & { externalId: string }): Promise<NormalizedReview[]>;
  enrich?(
    input: ProviderContext & {
      externalId: string;
      kind: EnrichmentKind;
      developerId?: string | null;
    },
  ): Promise<EnrichmentResult>;
}
export type Providers = Record<StoreName, Provider>;
export interface AppFilters {
  country?: string;
  store?: string;
  classification?: string;
  loanVerdict?: 'strong' | 'possible' | 'insufficient';
  q?: string;
  limit?: number;
  offset?: number;
}

export const enrichmentKinds = [
  'permissions',
  'dataSafety',
  'privacy',
  'versionHistory',
  'inAppPurchases',
  'ratings',
  'developer',
] as const;
export type EnrichmentKind = (typeof enrichmentKinds)[number];
export type EnrichmentStatus = 'available' | 'empty' | 'failed' | 'unsupported';
export interface EnrichmentContext {
  source: string;
  requestCountry: string | null;
  requestLanguage: string | null;
  note?: string | null;
}
export interface EnrichmentResult extends EnrichmentContext {
  status: Exclude<EnrichmentStatus, 'failed'>;
  data: unknown;
  raw: unknown;
}
export interface Enrichment extends EnrichmentContext {
  appId: number;
  kind: EnrichmentKind;
  status: EnrichmentStatus;
  fetchedAt: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string;
  attemptSource: string;
  attemptRequestCountry: string | null;
  attemptRequestLanguage: string | null;
  data: unknown;
  raw: unknown;
  error: string | null;
}
export interface EnrichmentHistory extends EnrichmentContext {
  id: number;
  appId: number;
  kind: EnrichmentKind;
  status: EnrichmentStatus;
  fetchedAt: string;
  data: unknown;
  raw: unknown;
  error: string | null;
}
export interface DiscoveryObservation {
  id: number;
  appId: number;
  observedAt: string;
  keyword: string;
  requestCountry: string;
  requestLanguage: string;
  source: string;
  data: NormalizedApp;
  raw: unknown;
}
