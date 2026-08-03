import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { sb } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/format'
import { api } from '@/lib/api'
import { trackView } from '@/lib/telemetry'
import { House, Users, Phone, Layers, Plus, LogOut, Menu, X, BarChart3, Settings as SettingsIcon, Receipt, BookOpen, Dumbbell, ShieldCheck, Megaphone, CalendarClock } from 'lucide-react'

const groups = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: House, end: true },
      { to: '/clients', label: 'Clients', icon: Users, end: false },
      { to: '/calls', label: 'Calls', icon: Phone, end: false },
      { to: '/meetings', label: 'Meetings', icon: CalendarClock, end: false },
      { to: '/metrics', label: 'Metrics', icon: BarChart3, end: false },
      { to: '/billing', label: 'Billing', icon: Receipt, end: false },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/playbooks', label: 'Playbooks', icon: Layers, end: false },
      { to: '/practice', label: 'Practice', icon: Dumbbell, end: false, flag: 'practice_mode' },
      { to: '/knowledge', label: 'Knowledge', icon: BookOpen, end: false, flag: 'knowledge_base' },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
    ],
  },
]

const titleFor = (path: string) => {
  if (path === '/') return 'Dashboard'
  if (path.startsWith('/clients')) return 'Clients'
  if (path.startsWith('/calls')) return 'Calls'
  if (path.startsWith('/meetings')) return 'Meetings'
  if (path.startsWith('/metrics')) return 'Metrics'
  if (path.startsWith('/billing')) return 'Billing'
  if (path.startsWith('/playbooks')) return 'Playbooks'
  if (path.startsWith('/practice')) return 'Practice'
  if (path.startsWith('/knowledge')) return 'Knowledge'
  if (path.startsWith('/settings')) return 'Settings'
  if (path.startsWith('/admin')) return 'Admin'
  if (path.startsWith('/new')) return 'New Call'
  if (path.startsWith('/live')) return 'Live Call'
  return 'Closer Copilot'
}

function SidebarContent({ email, onNavigate, isAdmin, flags }:
  { email: string; onNavigate?: () => void; isAdmin?: boolean; flags?: Record<string, boolean> }) {
  const navigate = useNavigate()
  // a nav item with a `flag` only renders when an admin has that flag switched on
  const allowed = (it: any) => !it.flag || flags?.[it.flag] !== false
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 py-4">
        <img src="/brand/mark-blue.png" alt="" className="h-5 w-5 dark:hidden" />
        <img src="/brand/mark-white.png" alt="" className="hidden h-5 w-5 dark:block" />
        <span className="text-[15px] font-semibold tracking-tight">Closer <span className="font-bold">Copilot</span></span>
      </div>

      <div className="px-3">
        <Button className="h-11 w-full justify-center" onClick={() => { navigate('/new'); onNavigate?.() }}>
          <Plus className="h-4 w-4" /> New Call
        </Button>
      </div>

      <nav className="mt-5 flex flex-col gap-6 px-3">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.label}</div>
            <div className="flex flex-col gap-0.5">
              {g.items.filter(allowed).map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-[44px] items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                      isActive && 'bg-secondary text-foreground'
                    )
                  }
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}

        {isAdmin && (
          <div>
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">System</div>
            <NavLink
              to="/admin"
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[44px] items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                  isActive && 'bg-secondary text-foreground'
                )
              }
            >
              <ShieldCheck className="h-[18px] w-[18px]" />
              Admin
            </NavLink>
          </div>
        )}
      </nav>

      <div className="mt-auto border-t border-border p-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials(email)}
          </div>
          <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{email}</div>
          <button onClick={() => sb.auth.signOut()} title="Sign out"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 px-1.5 text-[10px] text-muted-foreground/60">Owned by Vextria AI</div>
      </div>
    </>
  )
}

export default function AppShell({ email }: { email: string }) {
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [notices, setNotices] = useState<{ announcements: any[]; flags: Record<string, boolean> }>({ announcements: [], flags: {} })
  const [dismissed, setDismissed] = useState<string[]>(() => JSON.parse(localStorage.getItem('cc-dismissed') || '[]'))

  // close the mobile drawer whenever the route changes
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // the Admin link only appears for admins; the panel itself re-checks server-side
  useEffect(() => {
    api<{ isAdmin?: boolean }>('/api/admin/whoami').then((r) => setIsAdmin(!!r.isAdmin)).catch(() => {})
    api<{ announcements: any[]; flags: Record<string, boolean> }>('/api/notices')
      .then((r) => setNotices({ announcements: r.announcements || [], flags: r.flags || {} })).catch(() => {})
  }, [])

  const dismiss = (id: string) => {
    const next = [...dismissed, id]
    setDismissed(next); localStorage.setItem('cc-dismissed', JSON.stringify(next))
  }
  const visible = notices.announcements.filter((a) => !dismissed.includes(a.id))

  // product analytics: one page-view per route change
  useEffect(() => { trackView(pathname) }, [pathname])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <SidebarContent email={email} isAdmin={isAdmin} flags={notices.flags} />
      </aside>

      {/* mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-xl">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent email={email} isAdmin={isAdmin} flags={notices.flags} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4 md:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold">{titleFor(pathname)}</h1>
          <div className="ml-auto"><ThemeToggle compact /></div>
        </header>
        <main className="flex-1 overflow-y-auto">
          {visible.map((a) => (
            <div key={a.id} className={cn('flex items-start gap-2.5 border-b px-4 py-2.5 text-sm md:px-6',
              a.level === 'critical' ? 'border-destructive/25 bg-destructive/10' :
              a.level === 'warn' ? 'border-amber-500/25 bg-amber-500/10' : 'border-border bg-secondary/50')}>
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="font-semibold">{a.title}</span>
                {a.body && <span className="ml-2 text-muted-foreground">{a.body}</span>}
              </div>
              <button onClick={() => dismiss(a.id)} aria-label="Dismiss"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
