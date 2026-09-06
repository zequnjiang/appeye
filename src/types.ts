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
export interface MarketApp {
  id: number;
  store: StoreName;
  externalId: string;
  country: string;
  title: string;
  developer: string | null;
  icon: string | null;
  url: string | null;
  summary: string | null;
  description: string | null;
  version: string | null;
  score: number | null;
  ratings: number | null;
  installs: string | null;
  minInstalls: number | null;
  maxInstalls: number | null;
  releaseNotes: string | null;
  releasedAt: string | null;
  storeUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastFetchedAt: string | null;
  lastError?: string | null;
  classification: Classification;
  updateCount: number;
  observedUpdateIntervalDays: number | null;
  [key: string]: unknown;
}
export interface Change {
  id: number;
  appId: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  observedAt: string;
  createdAt?: string;
  title?: string;
  appTitle?: string;
  country?: string;
  store?: StoreName;
  [key: string]: unknown;
}
export interface Snapshot {
  id: number;
  observedAt: string;
  data: {
    score?: number | null;
    ratings?: number | null;
    minInstalls?: number | null;
    version?: string | null;
    [key: string]: unknown;
  };
  raw?: unknown;
  [key: string]: unknown;
}
export interface Review {
  id: number | string;
  externalId?: string;
  userName: string | null;
  title: string | null;
  text: string;
  score: number | null;
  version: string | null;
  reviewedAt?: string;
  updatedAt?: string;
  date?: string;
  observedAt?: string;
  country?: string;
  language?: string;
  replyText?: string | null;
  [key: string]: unknown;
}
export interface Job {
  id: number;
  type: 'discover' | 'refresh' | 'reviews';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  country: string | null;
  store: StoreName | null;
  appId: number | null;
  attempts: number;
  maxAttempts: number;
  progress: unknown;
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string;
  [key: string]: unknown;
}
export interface Overview {
  stats: {
    newApps7d?: number;
    apps: number;
    confirmed: number;
    candidates: number;
    changes7d: number;
    reviews: number;
    jobsFailed: number;
  };
  countries: {
    code: string;
    name: string;
    apps: number;
    confirmed: number;
    candidates: number;
    changes7d: number;
  }[];
  recentDiscoveries?: MarketApp[];
  recentChanges: Change[];
  recentJobs: Job[];
  limitations: string[];
  [key: string]: unknown;
}
export interface Session {
  authenticated: boolean;
  configured: boolean;
  demoMode?: boolean;
  dataset?: string;
  [key: string]: unknown;
}
