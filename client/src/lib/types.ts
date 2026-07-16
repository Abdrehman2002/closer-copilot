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

export interface CallDetail {
  id: string
  created_at: string
  summary: string
  product_name: string
  duration_sec: number
  deal_id: string | null
  transcript: Turn[]
  cards: CardData[]
  outcome?: Outcome
  saved_deal?: boolean | null
  saved_deal_note?: string
  deals?: { name: string; company: string } | null
}

export interface ClientDetail {
  id: string
  name: string
  company: string
  status: Status
  notes: string
  memory_md: string
  calls: { id: string; created_at: string; summary: string; duration_sec: number }[]
}

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
}

// live-call streaming event from /events
export type LiveEvent =
  | { type: 'transcript'; ch: 'me' | 'prospect'; text: string }
  | { type: 'interim'; ch: 'me' | 'prospect'; text: string }
  | { type: 'card-stream'; id?: number; tone: string; line: string; why: string; technique: string; done: boolean }
  | { type: 'status'; msg: string }
