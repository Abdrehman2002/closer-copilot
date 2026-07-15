import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { sb } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import Landing from '@/pages/Landing'
import Onboarding from '@/pages/Onboarding'
import AppShell from '@/components/AppShell'
import Home from '@/pages/Home'
import Clients from '@/pages/Clients'
import ClientDetail from '@/pages/ClientDetail'
import Calls from '@/pages/Calls'
import CallDetail from '@/pages/CallDetail'
import Playbooks from '@/pages/Playbooks'
import PlaybookNew from '@/pages/PlaybookNew'
import PlaybookDetail from '@/pages/PlaybookDetail'
import NewCall from '@/pages/NewCall'
import LiveCall from '@/pages/LiveCall'

const Loading = () => <div className="grid h-screen place-items-center text-sm text-muted-foreground">Loading…</div>

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [me, setMe] = useState<Me | null | undefined>(undefined)

  const loadMe = useCallback(() => api<Me>('/api/me').then(setMe), [])

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) setMe(undefined) })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => { if (session) loadMe() }, [session, loadMe])

  if (session === undefined) return <Loading />
  if (!session) return <Landing />
  if (me === undefined) return <Loading />
  if (me && !me.name) return <Onboarding me={me} onComplete={loadMe} />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell email={session.user.email ?? ''} />}>
          <Route path="/" element={<Home />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/calls/:id" element={<CallDetail />} />
          <Route path="/playbooks" element={<Playbooks />} />
          <Route path="/playbooks/new" element={<PlaybookNew />} />
          <Route path="/playbooks/:id" element={<PlaybookDetail />} />
          <Route path="/new" element={<NewCall />} />
          <Route path="/live" element={<LiveCall />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
