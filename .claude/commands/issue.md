---
description: Implement a Linear issue's named plan tasks, record progress, tag the commit, and move the issue to Done.
argument-hint: <HRN-issue-number>
---

Run Hurbad Hardware Linear issue `$ARGUMENTS` end to end in this project.

## 1. Resolve the issue and inspect current state

- Accept a full identifier such as `HRN-2`, or a positive integer such as `2` (normalize it to `HRN-2`). If the argument is missing or invalid, request the identifier; do not guess a task.
- Use the connected Linear tools to fetch the full issue, its parent, sub-issues, dependencies, acceptance criteria, and relevant comments. Verify it belongs to the HRN team in the HurbadNexus workspace and the HurbadHardware project. Do not use issues from the older HHR/HUR teams or deleted/replaced HRN teams. Resolve the live team and project rather than trusting historical IDs in local planning snapshots.
- Inspect repository instructions, Git status, existing progress notes, commits, and tags. Preserve unrelated user changes and stage only this issue's files. Never reset the checkout or force-replace a tag. If this project is not yet a Git repository, initialize it before the first task commit; do not create a nested repository inside another checkout.
- Read dependencies and verify prerequisites against the implementation and recorded evidence. Do not mark missing prerequisites complete. If blocked, report the specific prerequisite and leave the issue unfinished.
- If the issue is already Done, verify its recorded commits, tag, and required checks. Report existing completion when the evidence is sufficient; do not duplicate commits or tags.

## 2. Read the authoritative requirements

- Read `docs/README.md` and follow its required reading order before writing implementation code. This is the canonical path, including when a request misspells it as `dcos/ReadMe.md`.
- Read `docs/plans/RECONCILIATION.md` completely. Its rulings override conflicting phase-plan instructions. Apply especially sections H (design), I (platform changes), and J (WhatsApp providers), including newer rulings that supersede older rows in that same document.
- Open the phase plan and the exact task numbers named in the issue. Read each entire task, including files, interfaces, tests, implementation steps, commit instructions, prerequisites, and referenced specifications. Linear descriptions summarize tasks; they do not replace the full plans.
- Resolve conflicts using the documented precedence: reconciliation rulings, canonical Prisma schema, specifications, then phase plans. Use exact names and the required dependency majors. Do not silently substitute services or reopen settled decisions.
- For a task issue, implement only its named task(s). For a phase parent, fetch all its child issues and execute their unfinished plan tasks in numeric plan order, closing each child only after its own completion requirements are satisfied. Do not expand into unrelated phases. Verify completed children's evidence rather than repeating their work.
- If the named task or plan cannot be resolved unambiguously, request the missing information before implementation. Do not infer plan task numbers from the Linear ID; `HRN-2` and plan task `0.02` are different identifiers.

## 3. Implement and verify

- Move the selected issue to the live HRN team's **In Progress** status once prerequisites and scope are resolved. When processing a phase parent, also update the child currently being implemented.
- Follow the plan's task steps in order: write the specified failing test, run it and observe the failure, implement the requirement, run the specified checks, then commit with the prescribed conventional commit message. Manual provisioning tasks require their documented evidence instead of invented automated tests.
- No placeholder implementations or unrequested V2 scaffolding. Build fake adapters alongside real provider adapters; tests must use fakes rather than contacting live providers. Add English and Somali strings together and maintain translation parity where required.
- For UI work, read `design/DESIGN.md` and `docs/specs/14-design-integration.md`, inspect the mapped artboards, and capture the required 1440px and 390px screenshots. Run the prescribed visual checks.
- Run each task's required verification. If the selected scope includes a phase gate, run the exact gate commands in `docs/specs/12-testing.md` and the phase plan; preserve real command output. Never report an unrun check as passing.
- Keep secrets out of chat, logs, screenshots, and commits. If credentials or manual provisioning are necessary, name the environment variables or dashboard steps the user must complete; never request secret values in chat. Continue independent work, but do not claim the credential-dependent work is verified until it is.
- Do not auto-publish, push Git commits/tags, or perform real-money transactions merely to close an issue. Perform only explicitly authorized external actions and report any completion requirement that remains blocked.

## 4. Record progress, commit, and tag

- After each implemented plan task, commit the deliverable and update `docs/plans/progress/phase-NN.md` (create it using the phase plan's skeleton if absent). Preserve existing entries.
- Record the Linear identifier/link, phase and task number, completion checkboxes, implementation commit hash(es), verification commands/results, required gate output, screenshot paths where applicable, and any deviations or blockers. Do not record secret values or mark unverified work complete.
- Use the Git tag explicitly specified in the issue when present. Otherwise use `issue-<lowercase-identifier>`; for example, `HRN-2` becomes `issue-hrn-2`. For a phase parent, tag each finished child and the parent when the entire phase is complete.
- Include the intended tag name in the progress note, then commit that note with `docs: <ISSUE-ID> progress note`. Create the tag on this final progress commit, which includes the completed implementation in its history. Do not try to put the progress commit's own hash inside that same commit.
- Validate the tag name with Git before creating it. If the tag already exists on the verified completion commit, reuse it. If it points elsewhere, do not overwrite or move it; report the conflict and keep the issue unfinished until resolved.
- Verify the tag resolves to the intended commit and that this issue's changes are committed. Unrelated pre-existing changes do not need to be committed or discarded.

## 5. Close the Linear issue and report

- Only after implementation, required verification, progress recording, commits, and tagging succeed, update the issue's relevant acceptance checkboxes. Preserve unrelated text and leave any **Recorded** checkbox untouched.
- Append a completion record to the issue description with commit hash(es), final tagged commit hash, tag name, progress-note path, verification summary, and any approved deviations. Do not send unrelated messages or modify other projects.
- Resolve the live HRN team's completed status and move the issue to **Done**. Fetch it again to confirm the status and saved completion record. Do not close the phase parent until all required children and the phase gate are complete.
- If any required step fails, keep the issue unfinished and report exactly what succeeded and what remains. If only the Linear write fails after local completion, preserve the local commits/tag/progress and retry the external update without duplicating local work.
- Finish with the issue link, completed tasks, verification results, implementation/progress commits, tag, progress-note link, and any outstanding blocker. Never claim completion from a successful tool attempt alone; verify the resulting state.
