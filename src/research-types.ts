import type { MarketApp } from './types';
import type { MarketActivityEvent, MarketActivityResponse } from '../server/market-activity';
export type Role = 'platform' | 'admin' | 'researcher' | 'viewer';
export interface Principal {
  id: number;
  name: string;
  email: string | null;
  role: Role;
  workspaceId: number | null;
}
export interface WorkspaceRef {
  id: number;
  name: string;
  role?: Role;
  enabled?: boolean;
}
export interface ResearchSession {
  authenticated: boolean;
  configured: boolean;
  dataset?: string;
  user: Principal | null;
  workspaces: WorkspaceRef[];
  authorizationVersion?: string | number;
}
export type LoanScope = 'cash-priority' | 'personal' | 'other' | 'unknown' | 'all';
export const scopeLabels: Record<LoanScope, string> = {
  'cash-priority': '现金贷优先 · 含待细分',
  personal: '仅个人现金贷',
  other: '其他已确认信贷',
  unknown: '仅待细分',
  all: '全部已确认信贷',
};
export const categoryLabels: Record<string, string> = {
  personal: '个人现金贷',
  other: '其他信贷',
  unknown: '待细分',
};
export const roleLabels: Record<Role, string> = {
  platform: '平台运营',
  admin: '客户管理员',
  researcher: '研究员',
  viewer: '只读成员',
};
export const sortLabels = {
  minInstalls: '累计安装下限',
  title: '应用名称',
  developer: '开发者',
  firstSeenAt: '系统首次发现',
  releasedAt: '商店发布时间',
  storeUpdatedAt: '最近更新时间',
  lastFetchedAt: '最近采集时间',
  score: '评分',
  ratings: '评分人数',
};
export interface LibraryQuery {
  country: string;
  store: string;
  q: string;
  loanScope: LoanScope;
  sort: keyof typeof sortLabels;
  direction: 'asc' | 'desc';
  from: string;
  to: string;
  minScore: string;
  minInstalls: string;
}
export const defaultLibraryQuery: LibraryQuery = {
  country: '',
  store: '',
  q: '',
  loanScope: 'cash-priority',
  sort: 'minInstalls',
  direction: 'desc',
  from: '',
  to: '',
  minScore: '',
  minInstalls: '',
};
export interface MarketPage {
  apps: MarketApp[];
  total: number;
  limit: number;
  offset: number;
  snapshot: string;
  revision: string;
  createdAt: string;
  expiresAt: string;
  unknownTotal?: number;
}
export type ResearchActivity = Omit<MarketActivityResponse, 'countries'> & {
  unknownTotal?: number;
  featuredEvents: MarketActivityEvent[];
  countries: (MarketActivityResponse['countries'][number] & {
    apps: number;
    unknownApps?: number;
    latestEventAt: string | null;
    latestEvent: MarketActivityEvent | null;
  })[];
};
export interface ResearchGroup {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface ResearchCollection extends ResearchGroup {
  appIds: number[];
}
export interface Citation {
  kind: 'app' | 'snapshot' | 'change' | 'review' | 'enrichment';
  recordId?: number;
  field?: string;
  quote?: string;
  [key: string]: unknown;
}
export interface ResearchEntry {
  id: number;
  appId: number;
  collectionId: number | null;
  kind: 'note' | 'excerpt';
  text: string;
  citation: Citation | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
  appIdentity?: { id: number; title: string; externalId: string; country: string; store: string };
  appVisible?: boolean;
}
export interface IntakeRequest {
  id: number;
  country: string;
  store: string;
  externalId: string;
  status: string;
  appId: number | null;
  jobId: number | null;
  error: string | null;
  note?: string;
  workspaceName?: string;
  createdAt: string;
  updatedAt: string;
  resultObservedAt: string | null;
}
export interface ResearchState {
  apps?: MarketApp[];
  workspace: { id: number; name: string };
  groups: ResearchGroup[];
  favorites: { appId: number; groupId: number | null; createdAt: string }[];
  collections: ResearchCollection[];
  entries: ResearchEntry[];
  readStates: { eventId: string; readAt: string }[];
  requests: IntakeRequest[];
}
export const canWrite = (user: Principal) => user.role === 'admin' || user.role === 'researcher';
