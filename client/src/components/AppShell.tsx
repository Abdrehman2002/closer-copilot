import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { sb } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { House, Users, Phone, Layers, Plus, LogOut } from 'lucide-react'

const nav = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/clients', label: 'Clients', icon: Users, end: false },
  { to: '/calls', label: 'Calls', icon: Phone, end: false },
  { to: '/playbooks', label: 'Playbooks', icon: Layers, end: false },
]

export default function AppShell({ email }: { email: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-[#07090d] p-3">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="h-5 w-5 rounded-[6px] bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.55)]" />
          <span className="text-sm font-semibold tracking-tight">Closer <span className="font-bold">Copilot</span></span>
        </div>

        <Button className="mb-4 mt-2 w-full justify-center" onClick={() => navigate('/new')}>
          <Plus className="h-4 w-4" /> New Call
        </Button>

        <nav className="flex flex-col gap-0.5">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground',
                  isActive && 'bg-white/[0.07] text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]'
                )
              }
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-border pt-3">
          <div className="truncate px-2 pb-2 text-xs text-muted-foreground">{email}</div>
          <button
            onClick={async () => { await sb.auth.signOut() }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
