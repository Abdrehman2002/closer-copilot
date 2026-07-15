export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-6 rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
        This screen is being rebuilt in the new interface — coming next.
      </div>
    </div>
  )
}
