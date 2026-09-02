# Accessibility verification

The dashboard uses native form controls and landmarks, visible focus styles,
labelled status regions, and polite live regions for changing run and suite
progress. Standalone and suite progress bars expose their current value and a
readable text equivalent.

## Dashboard review

The following checks were completed in Chromium on 2026-09-02:

- Tab moves through the header navigation in visual order.
- Every experiment control and action is keyboard reachable with a visible
  focus indicator.
- Up and Down Arrow move between run and suite history entries.
- Active run progress announces phase, percentage, published count, and
  received count; active suite progress announces the current trial and the
  number of finished and remaining runs.
- Cancellation remains keyboard operable for both standalone runs and suites.
- Initial and populated dashboard states have no violations reported by Axe.
- Secondary text, capability labels, status text, and destructive actions meet
  the automated WCAG 2 AA color-contrast threshold.

The browser checks live in
`tests/e2e/dashboard-reliability-and-accessibility.e2e.ts` and run with
`npm run test:e2e`. Automated analysis cannot prove complete accessibility, so
repeat the keyboard and announcement review when interaction patterns or major
dashboard layouts change.
