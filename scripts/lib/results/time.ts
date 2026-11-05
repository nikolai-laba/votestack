export interface LocalTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** UTC offset (ms) of a time zone at a given instant. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant))
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** Converts a wall-clock time in a named time zone to a UTC ISO string. */
export function zonedToIso(local: LocalTime, timeZone: string): string {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  )
  // Two passes settle the offset across a DST change.
  let instant = naive - offsetMs(naive, timeZone)
  instant = naive - offsetMs(instant, timeZone)
  return new Date(instant).toISOString()
}
