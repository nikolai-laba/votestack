// Loads the words of the after-election thank-you notice from their file
// (NOTICE_WORDS_PATH), once per page load. Anything that goes wrong (no
// network, a missing or damaged file, words this code doesn't know) gives
// null, and the notice then shows nothing.

import { useQuery } from '@tanstack/react-query'
import {
  NOTICE_WORDS_PATH,
  parseNoticeWords,
  type NoticeWords,
} from '../shared/afterElection.ts'

/** The notice's words, or null when they can't be used. Never rejects. */
export async function fetchNoticeWords(): Promise<NoticeWords | null> {
  try {
    const response = await fetch(NOTICE_WORDS_PATH)
    if (!response.ok) return null
    return parseNoticeWords(await response.json())
  } catch {
    return null
  }
}

/** The notice's words once they've loaded; null until then or on failure. */
export function useNoticeWords(): NoticeWords | null {
  const { data } = useQuery({
    queryKey: ['notice-words'],
    queryFn: fetchNoticeWords,
    staleTime: Infinity,
    retry: false,
  })
  return data ?? null
}
