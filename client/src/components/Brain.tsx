import ReactMarkdown from 'react-markdown'

export function Brain({ md }: { md: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: (p) => <h2 className="mb-1 text-lg font-bold" {...p} />,
        h2: (p) => <h3 className="mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary" {...p} />,
        h3: (p) => <h4 className="mt-3 mb-1 text-sm font-semibold" {...p} />,
        p: (p) => <p className="my-1.5 text-sm leading-relaxed text-foreground/90" {...p} />,
        ul: (p) => <ul className="my-1 list-disc space-y-1 pl-5" {...p} />,
        li: (p) => <li className="text-sm leading-relaxed text-foreground/90" {...p} />,
        strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
        em: (p) => <em {...p} />,
      }}
    >
      {md}
    </ReactMarkdown>
  )
}
