/** Reserves the profile's space while it loads, so the page doesn't jump. */
export function ProfileSkeleton() {
  return (
    <div aria-hidden="true" className="max-w-[65ch] space-y-4">
      <div className="h-11 w-48 rounded-sm bg-band" />
      <div className="h-10 w-2/3 rounded-sm bg-band" />
      <div className="h-20 rounded-sm bg-band" />
      <div className="h-40 rounded-sm bg-band" />
      <div className="h-32 rounded-sm bg-band" />
    </div>
  )
}
