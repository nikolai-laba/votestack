// Streams a CSV file as objects keyed by its header row. Handles quoted
// fields with commas, doubled quotes and line breaks.

import { createReadStream } from 'node:fs'

export async function* csvRows(
  path: string,
): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null
  let field = ''
  let row: string[] = []
  let quoted = false
  let pendingQuote = false
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    for (const ch of chunk as string) {
      if (quoted) {
        if (pendingQuote) {
          pendingQuote = false
          if (ch === '"') {
            field += '"'
            continue
          }
          quoted = false
        } else if (ch === '"') {
          pendingQuote = true
          continue
        } else {
          field += ch
          continue
        }
      }
      if (ch === '"' && field === '') quoted = true
      else if (ch === ',') {
        row.push(field)
        field = ''
      } else if (ch === '\n') {
        row.push(field.replace(/\r$/, ''))
        field = ''
        if (!header) header = row.map((h) => h.replace(/^﻿/, ''))
        else if (row.length > 1 || row[0] !== '')
          yield Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']))
        row = []
      } else field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (header)
      yield Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']))
  }
}
