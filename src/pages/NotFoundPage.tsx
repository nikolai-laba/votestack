import { Link } from 'react-router'
import { NOT_FOUND_HEAD, useDocumentHead } from '../head.ts'

export function NotFoundPage() {
  useDocumentHead(NOT_FOUND_HEAD)
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
