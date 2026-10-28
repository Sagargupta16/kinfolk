# Family atlas experience

Prepared 2026-09-10 for 0.4.0, released and deployed the same day.
This direction applies to both the Next application and the Vite client.

## Main tasks

1. Find a person in the tree or the People list.
2. Open their profile to read family relationships, personal details, or private contacts.
3. Add a relative by choosing the relationship and entering a name.
4. Share access with family, or propose a match that both record owners must accept.

Tree arrangement, card density, social links and recent activity remain available under
Options. They are secondary to reading and growing a family.

Since 0.7.0 a family you can edit is built from the cards alone. A tap picks a person and
puts their `+` handles on the card; the `+` opens a small strip at the card for a name, an
optional year and the two gendered answers; a second tap on the same card opens the same
kind of strip for their name and year, with the full profile and delete one press away. The
profile opens only when asked for: from that strip, the People list, the activity feed, or
the `p` key. A read-only canvas keeps tap-to-read.
Profiles group their information into Family, About, and Contact.
Contact values stay on their own authorized page and never appear on the canvas.
Share opens family access; Link family records in the account menu opens the consent workflow.

## Research

- [FamilySearch: adding a parent](https://www.familysearch.org/en/help/helpcenter/article/how-do-i-add-a-parent-in-family-tree)
  starts with the existing child, then the relationship. Kinfolk follows that order:
  the `+` sits on the existing person's card, in the direction the relative will appear,
  and the strip it opens names the subject in its placeholder and its accessible name.
- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
  recommends putting frequent tasks first and clearly naming the way to secondary
  controls. Kinfolk keeps Tree, People and search visible, puts adding a relative on the
  viewed card itself, and Options contains the less frequent canvas controls.

These are design inputs, not evidence from a usability study of Kinfolk.

## Visual and motion language

The reference is the current local portfolio-react implementation and its CLAUDE.md:
flat opaque surfaces, near-black `#0b1012` in dark mode, `#2563eb` primary actions,
and `#60a5fa` dark-mode accents. Bricolage Grotesque leads headings, Inter carries body
text, and JetBrains Mono carries metadata. Fonts are served locally, with separate
light-theme tokens.

The family illustration assembles in relationship order. Menus and profile content
use short transform and opacity transitions. The canvas keeps fixed node dimensions,
and hover state never triggers a graph layout. Full motion is the default; the explicit
Reduced setting freezes decorative sequences and removes viewport travel animation.

A write from the canvas is one storyboard under 1.5 seconds, timed with the shared
svg-forge presets: the strip grows out of the `+` on a damped spring and folds back into
it; cards that change place glide there from where they were on screen; the new relative
comes out of the `+` they were added from and lands with a ring; the family lines that
moved draw back on as the cards come to rest; the viewed card never moves. Picking a person
pops their handles in one after another and pings them three times, inside five seconds.

Both themes, keyboard access, touch targets, narrow screens, and both application
runtimes were included in the local checks. The [verification report](verification-0.4.0.md)
records the results and limits.

Photo uploads remain outside the implemented workflow until the private provider
and authentication flow are approved. Initials remain the profile image.
