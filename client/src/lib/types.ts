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
export interface CardData { tone: string; line: string; why: string; technique: string; at?: number }

export interface CallDetail {
  id: string
  created_at: string
  summary: string
  product_name: string
  duration_sec: number
  deal_id: string | null
  transcript: Turn[]
  cards: CardData[]
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

export interface HomeData {
  email: string
  stats: { total: number; open: number; won: number; lost: number }
  recentClients: ClientRow[]
  recentCalls: (CallRow & { client: string })[]
}

export interface Me {
  email: string
  name: string
  hasProducts: boolean
  hasClients: boolean
  productTemplate: string
}

// live-call streaming event from /events
export type LiveEvent =
  | { type: 'transcript'; ch: 'me' | 'prospect'; text: string }
  | { type: 'interim'; ch: 'me' | 'prospect'; text: string }
  | { type: 'card-stream'; tone: string; line: string; why: string; technique: string; done: boolean }
  | { type: 'status'; msg: string }
