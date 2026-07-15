import { Skeleton } from '@/components/ui/skeleton'

/** Generic route-level fallback used by React.lazy/Suspense in App.tsx. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[900px] px-8 py-7">
      <Skeleton className="mb-6 h-7 w-48" />
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  )
}

/** For a bordered row-list card (Clients, Calls, Playbooks). */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}>
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/** Detail page: a header line + a big content card. */
export function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[900px] px-8 py-7">
      <Skeleton className="mb-4 h-4 w-20" />
      <Skeleton className="mb-1 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-32" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

/** Dashboard: Focus hero + move rows + right rail cards. */
export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1180px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        </div>
        <div className="space-y-5">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-52 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
