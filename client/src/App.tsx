import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { sb } from '@/lib/supabase'
import Login from '@/pages/Login'
import AppShell from '@/components/AppShell'
import Home from '@/pages/Home'
import Placeholder from '@/pages/Placeholder'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined)
    return <div className="grid h-screen place-items-center text-sm text-muted-foreground">Loading…</div>
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell email={session.user.email ?? ''} />}>
          <Route path="/" element={<Home />} />
          <Route path="/clients" element={<Placeholder title="Clients" />} />
          <Route path="/clients/:id" element={<Placeholder title="Client" />} />
          <Route path="/calls" element={<Placeholder title="Calls" />} />
          <Route path="/calls/:id" element={<Placeholder title="Call" />} />
          <Route path="/playbooks" element={<Placeholder title="Playbooks" />} />
          <Route path="/playbooks/new" element={<Placeholder title="New playbook" />} />
          <Route path="/new" element={<Placeholder title="New Call" />} />
          <Route path="/live" element={<Placeholder title="Live Call" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
