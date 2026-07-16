export type Status = 'open' | 'won' | 'lost'

export interface ClientRow {
  id: string
  name: string
  company: string
  status: Status
  calls: number
  created_at?: string
}

export interface CallRow {
  id: string
  created_at: string
  summary: string
  product_name: string
  duration_sec: number
  client?: string
  company?: string
}

export interface Turn { ch: 'me' | 'prospect'; text: string }
export interface CardData { id?: number; tone: string; line: string; why: string; technique: string; at?: number; used?: boolean | null; confidence?: 'high' | 'low' }

export type Outcome = 'unknown' | 'closed' | 'lost' | 'follow_up'
export interface GoalOption { id: string; label: string }

export interface CallDetail {
  id: string
  created_at: string
  summary: string
  product_name: string
  duration_sec: number
  deal_id: string | null
  transcript: Turn[]
  cards: CardData[]
  goal?: string
  outcome?: Outcome
  saved_deal?: boolean | null
  saved_deal_note?: string
  review_score?: number | null
  review_notes?: string
  deals?: { name: string; company: string } | null
}

export interface ClientDetail {
  id: string
  name: string
  company: string
  status: Status
  notes: string
  memory_md: string
  close_amount?: number | null
  close_reason?: string
  calls: { id: string; created_at: string; summary: string; duration_sec: number }[]
}

export interface DocumentRow { id: string; name: string; content: string; scope: 'global' | 'deal'; deal_id: string | null; created_at?: string }
export interface ReminderRow { id: string; title: string; dealId: string | null; dueAt: string; clientName?: string | null; overdue?: boolean }

export interface Product { id: string; name: string; content?: string }

export type MoveType = 'waiting' | 'follow_up' | 'ready' | 'cold' | 'motion' | 'first'
export interface NextMove {
  id: string
  name: string
  company: string
  type: MoveType
  action: string
  days: number | null
  howToClose: string
  score: number
}

export interface DashboardData {
  moves: NextMove[]
  focus: NextMove | null
  cues: { playbookId: string; playbookName: string; objections: { objection: string; say: string }[] } | null
  radar: { objection: string; count: number }[]
  gaps: { objection: string; count: number }[]
  wins: { id: string; name: string; company: string }[]
  reminders: ReminderRow[]
}

export type Warmth = 'hot' | 'warming' | 'cold'
export interface PipelineDeal {
  id: string
  name: string
  company: string
  calls: number
  lastCallAt: string | null
  hasBrain: boolean
  snapshot: string
  openObjections: string[]
  nextStep: string
  howToClose: string
  warmth: Warmth
}

export interface HomeData {
  email: string
  stats: { total: number; open: number; won: number; lost: number }
  recentClients: ClientRow[]
  recentCalls: (CallRow & { client: string })[]
}

export interface Me {
  email: string
  name: string
  tone: string
  framework: string
  signature_phrases: string
  never_say: string
  hasProducts: boolean
  hasClients: boolean
  productTemplate: string
}

export interface Metrics {
  totalCalls: number
  lineAcceptancePct: number | null
  linesRated: number
  savedDeals: number
  closeRatePct: number | null
  decidedCalls: number
  activeDays: number
  last14: { day: string; calls: number }[]
  talkRatioPct: number | null
  revenue: number
  wonDeals: number
}

export interface Billing {
  totalCost: number
  totalTokens: number
  events: number
  unpricedEvents: number
  byModel: { model: string; tokens: number; cost: number; unpriced: boolean }[]
  byKind: { kind: string; tokens: number; cost: number }[]
  last14: { day: string; cost: number }[]
}

// live-call streaming event from /events
export type LiveEvent =
  | { type: 'transcript'; ch: 'me' | 'prospect'; text: string }
  | { type: 'interim'; ch: 'me' | 'prospect'; text: string }
  | { type: 'card-stream'; id?: number; tone: string; line: string; why: string; technique: string; done: boolean }
  | { type: 'status'; msg: string }
