import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { sb } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/format'
import { House, Users, Phone, Layers, Plus, LogOut, Menu, X } from 'lucide-react'

const groups = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: House, end: true },
      { to: '/clients', label: 'Clients', icon: Users, end: false },
      { to: '/calls', label: 'Calls', icon: Phone, end: false },
    ],
  },
  {
    label: 'Library',
    items: [{ to: '/playbooks', label: 'Playbooks', icon: Layers, end: false }],
  },
]

const titleFor = (path: string) => {
  if (path === '/') return 'Dashboard'
  if (path.startsWith('/clients')) return 'Clients'
  if (path.startsWith('/calls')) return 'Calls'
  if (path.startsWith('/playbooks')) return 'Playbooks'
  if (path.startsWith('/new')) return 'New Call'
  if (path.startsWith('/live')) return 'Live Call'
  return 'Closer Copilot'
}

function SidebarContent({ email, onNavigate }: { email: string; onNavigate?: () => void }) {
  const navigate = useNavigate()
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 py-4">
        <div className="h-5 w-5 rounded-[6px] bg-primary" />
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
              {g.items.map(({ to, label, icon: Icon, end }) => (
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
      </div>
    </>
  )
}

export default function AppShell({ email }: { email: string }) {
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // close the mobile drawer whenever the route changes
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <SidebarContent email={email} />
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
            <SidebarContent email={email} onNavigate={() => setDrawerOpen(false)} />
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
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
