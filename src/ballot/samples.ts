// Sample ballots on /getstarted, for people outside Cook County or who
// want to see how VoteStack works before entering an address. Each is the
// ballot for one public landmark's address, looked up like any other, and
// opens at /. A sample lives only in memory (BallotSessionProvider): it is
// never saved on the device, never replaces the voter's own ballot or
// picks, and never goes in the URL.

export interface SampleBallot {
  id: string
  /** The button's label. */
  label: string
  /** Finishes "Sample ballot for the area around …". */
  place: string
  /** A public building's address, as the lookup takes it. */
  address: string
}

export const SAMPLE_BALLOTS: readonly SampleBallot[] = [
  {
    id: 'oak-park',
    label: 'Oak Park Village Hall',
    place: 'Oak Park Village Hall',
    address: '123 Madison St, Oak Park, IL 60302',
  },
  {
    id: 'wrigleyville',
    label: 'Wrigleyville',
    place: 'Wrigley Field',
    address: '1060 W Addison St, Chicago, IL 60613',
  },
  {
    id: 'art-institute',
    label: 'Art Institute of Chicago',
    place: 'the Art Institute of Chicago',
    // The museum's street address (111 S Michigan Ave) has no Cook County
    // address point. This one sits on the museum's grounds, east of
    // Michigan Avenue (the street is a ward line, so the west side's
    // addresses get a different ballot).
    address: '201 S Michigan Ave, Chicago, IL 60604',
  },
]
