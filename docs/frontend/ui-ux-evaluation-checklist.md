# UI/UX Evaluation Checklist

This is a lightweight checklist to audit the current UI implementation against `docs/frontend/ui-ux-design-guidelines.md`.

Status legend:

- `[x]` Verified in current repo
- `[ ]` TODO / unknown

## High Priority

- [ ] Mobile-first layout (base styles for smallest screens, progressive enhancement via `min-width` media queries)
- [ ] Touch targets meet 44x44 minimum on mobile
- [ ] Keyboard navigation and visible focus states across all interactive controls
- [ ] Clear error states for upload/record/live session flows

## Medium Priority

- [ ] Consistent spacing scale (4px/8px increments or a clear system)
- [ ] Readable transcript typography (line height, max width, contrast)
- [ ] Results summary rail does not over-emphasize operational fields for non-operational content

## Low Priority

- [ ] Meaningful motion that respects `prefers-reduced-motion`
- [ ] Performance: no blocking external font requests; reasonable bundle size

## Notes

- If you want to record an evaluation for a specific PR or change, create a dated file under `docs/deprecated/` (for example `docs/deprecated/ui-ux-eval-YYYY-MM-DD.md`) and keep it scoped to the change.
