# Family atlas experience

Prepared 2026-09-10 for the unpublished 0.4.0 work on `codex/production-corrections`.
This direction applies to both the Next application and the Vite client.

## Main tasks

1. Find a person in the tree or the People list.
2. Open their profile to read family relationships, personal details, or private contacts.
3. Add a relative by choosing the relationship and entering a name.
4. Share access with family, or propose a match that both record owners must accept.

Tree arrangement, card density, social links, and connecting existing people remain
available under Options. They are secondary to reading and growing a family.
Profiles group their information into Family, About, and Contact.
Contact values stay on their own authorized page and never appear on the canvas.
Share opens family access; Link family records in the account menu opens the consent workflow.
The existing-people editor can attach or detach a child without deleting their profile.

## Research

- [FamilySearch: adding a parent](https://www.familysearch.org/en/help/helpcenter/article/how-do-i-add-a-parent-in-family-tree)
  starts with the existing child, then the relationship. Kinfolk follows that order
  and makes the subject visible in the add form.
- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
  recommends putting frequent tasks first and clearly naming the way to secondary
  controls. Kinfolk keeps Tree, People, search, and Add relative visible; Options
  contains the less frequent canvas controls.

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

Both themes, keyboard access, touch targets, narrow screens, and both application
runtimes were included in the local checks. The [verification report](verification-0.4.0.md)
records the results and limits.

Photo uploads remain outside the implemented workflow until the private provider
and authentication flow are approved. Initials remain the profile image.
