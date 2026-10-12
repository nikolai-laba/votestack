import type { OverviewParagraph, Section } from '../../shared/profile.ts'
import { Cite } from './Cite.tsx'
import { ProfileSection } from './ProfileSection.tsx'

/**
 * Cited paragraphs; how many depends on the race's tier, not the candidate.
 * A paragraph with sentences cites each one where it ends; an older one
 * without them cites the paragraph as a whole.
 */
export function Overview({ section }: { section: Section<OverviewParagraph> }) {
  return (
    <ProfileSection
      id="overview"
      title="Overview"
      asOf={section.asOf}
      empty={section.items.length === 0}
    >
      <div className="space-y-4">
        {section.items.map((paragraph, i) => (
          <p key={i}>
            {paragraph.sentences && paragraph.sentences.length > 0 ? (
              paragraph.sentences.map((s, j) => (
                <span key={j}>
                  {j > 0 && ' '}
                  {s.text.trim()}
                  <Cite ids={s.cites} />
                </span>
              ))
            ) : (
              <>
                {paragraph.text}
                <Cite ids={paragraph.cites} />
              </>
            )}
          </p>
        ))}
      </div>
    </ProfileSection>
  )
}
