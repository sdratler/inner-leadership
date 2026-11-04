# Visual acceptance and regression rubric

Derived procedure for `THQ-VISUAL-QUALITY-20261103-01`. [Technology 11D, 13 and Appendix D8](https://docs.google.com/document/d/1PExKb2PwAFAHlBtgmQ9RU-JdfTfQ-jTk41SpWetn7w8/edit?tab=t.0) own the reusable rule; current Fishing Website/UI own the actual design. This is not a price, copy or brand master.

## Evidence and disposition

In the existing task record, use one row per finding:

`requirement/source | viewport/locale/state | observed defect + image/trace | severity | OPEN/fixed | correction + recheck evidence | actual reviewer`

- **Critical:** unsafe, unusable or misleading interaction.
- **Major:** material brief mismatch, broken hierarchy, obscured subject/control, unreadable wrapping, accidental large blank region, inconsistent alignment/density.
- **Minor:** optional polish that does not breach a mandatory criterion. Do not relabel an owner-rejected defect merely to close it.

Known critical/major defects, failed mandatory criteria, missing required evidence or unresolved owner rejection mean **OPEN/NEEDS REVISION**. A visual-review pass requires the applicable brief and state coverage to be satisfied and actual images inspected. Keep technical pass, visual review, owner acceptance and live verification separate. No score, screenshot hash or test count establishes appearance quality.

## Demonstrate the check, without overfitting

1. Record the current brief before judging the retained BEFORE case. Distinguish a new scoped preference from an older violation. Identify actual evidence; an obscured screenshot cannot prove what was underneath it.
2. Reject the applicable bad case with a concrete observation. Under the November 3 Fishing brief, a boxed hero, accidental tall empty FAQ heading rail, missing required portrait or an inline-only primary form cannot pass their respective requirements. These are scoped examples, not universal design rules.
3. Inspect the corrected equivalent view and rerun only affected measurements/interactions. Do not replace expected snapshots simply to accept a changed implementation.
4. Choose a different holdout state before its result is known, such as a Hebrew dialog with two siblings, long labels and validation errors. In an isolated test-only DOM/CSS mutation, obscure a required control or break focus containment: the relevant check must fail. Remove the mutation and verify the retained product, never ship the bad fixture. A clean holdout may pass only after actual inspection.
5. Keep automated geometry/accessibility results distinct from visual critique. A no-overflow pass cannot disprove unreadable word stacks or poor composition. Record exactly which initial/full-page/expanded/error views were opened and by whom.

For a skill repair, additionally record installed/discoverable/fully loaded/exercised/outcome demonstrated separately. Fresh root/app evaluations must inspect actual effective instructions, applicable overrides and truncation, then trace ordinary-request selection without naming skills. Syntax checks or explicit invocation alone cannot prove implicit routing. Missing runtime evaluation stays NOT RUN; no guarantee about future taste or every future chat follows from one pass.
