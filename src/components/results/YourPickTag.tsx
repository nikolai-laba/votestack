/**
 * The voter's own pick, read-only, once an election has results: after the
 * picked name, or on the picked Yes or No row. The same for every pick.
 */
export function YourPickTag() {
  return (
    <>
      <span className="sr-only">, </span>
      {/* An en space (U+2002), not a margin, so a tag that wraps starts
          flush with the name. */}
      {'\u2002'}
      <span className="inline-block rounded-sm bg-highlight px-1.5 py-px align-[2px] text-caption font-bold whitespace-nowrap text-on-highlight">
        Your pick
      </span>
    </>
  )
}
