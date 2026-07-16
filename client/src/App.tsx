import { useCallback, useEffect, useState, Suspense, lazy } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { sb } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import Landing from '@/pages/Landing'
import Onboarding from '@/pages/Onboarding'
import AppShell from '@/components/AppShell'
import { PageSkeleton } from '@/components/Skeleton'

// Route-level code splitting: the shell/auth gate loads eagerly, everything
// behind sign-in loads on demand so the first paint (login/onboarding) stays light.
const Home = lazy(() => import('@/pages/Home'))
const Clients = lazy(() => import('@/pages/Clients'))
const ClientDetail = lazy(() => import('@/pages/ClientDetail'))
const Calls = lazy(() => import('@/pages/Calls'))
const CallDetail = lazy(() => import('@/pages/CallDetail'))
const Playbooks = lazy(() => import('@/pages/Playbooks'))
const PlaybookNew = lazy(() => import('@/pages/PlaybookNew'))
const PlaybookDetail = lazy(() => import('@/pages/PlaybookDetail'))
const NewCall = lazy(() => import('@/pages/NewCall'))
const LiveCall = lazy(() => import('@/pages/LiveCall'))
const Settings = lazy(() => import('@/pages/Settings'))
const Metrics = lazy(() => import('@/pages/Metrics'))
const Billing = lazy(() => import('@/pages/Billing'))
const Knowledge = lazy(() => import('@/pages/Knowledge'))

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
          <Route path="/" element={<Suspense fallback={<PageSkeleton />}><Home /></Suspense>} />
          <Route path="/clients" element={<Suspense fallback={<PageSkeleton />}><Clients /></Suspense>} />
          <Route path="/clients/:id" element={<Suspense fallback={<PageSkeleton />}><ClientDetail /></Suspense>} />
          <Route path="/calls" element={<Suspense fallback={<PageSkeleton />}><Calls /></Suspense>} />
          <Route path="/calls/:id" element={<Suspense fallback={<PageSkeleton />}><CallDetail /></Suspense>} />
          <Route path="/playbooks" element={<Suspense fallback={<PageSkeleton />}><Playbooks /></Suspense>} />
          <Route path="/playbooks/new" element={<Suspense fallback={<PageSkeleton />}><PlaybookNew /></Suspense>} />
          <Route path="/playbooks/:id" element={<Suspense fallback={<PageSkeleton />}><PlaybookDetail /></Suspense>} />
          <Route path="/new" element={<Suspense fallback={<PageSkeleton />}><NewCall /></Suspense>} />
          <Route path="/live" element={<Suspense fallback={<PageSkeleton />}><LiveCall /></Suspense>} />
          <Route path="/settings" element={<Suspense fallback={<PageSkeleton />}><Settings /></Suspense>} />
          <Route path="/metrics" element={<Suspense fallback={<PageSkeleton />}><Metrics /></Suspense>} />
          <Route path="/billing" element={<Suspense fallback={<PageSkeleton />}><Billing /></Suspense>} />
          <Route path="/knowledge" element={<Suspense fallback={<PageSkeleton />}><Knowledge /></Suspense>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
