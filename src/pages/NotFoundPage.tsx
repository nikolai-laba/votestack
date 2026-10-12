import { useEffect } from 'react'
import { Link } from 'react-router'

export function NotFoundPage() {
  useEffect(() => {
    const previous = document.title
    document.title = 'Page not found | VoteStack'
    return () => {
      document.title = previous
    }
  }, [])
  return (
    <section className="space-y-4">
      <h1 className="text-title lg:text-title-lg">Page not found</h1>
      <p className="max-w-[65ch]">This page doesn&apos;t exist.</p>
      <Link to="/" className="inline-flex min-h-11 items-center">
        Find my ballot
      </Link>
    </section>
  )
}
