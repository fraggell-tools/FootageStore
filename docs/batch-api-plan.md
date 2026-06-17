# Plan: move Claude clip analysis to the Anthropic Batch API

**Status:** proposed (not yet implemented)
**Author:** Claude Code session, 2026-06-17
**Owner:** Fraser

## Goal

Cut the Claude (Haiku 4.5) spend for clip analysis roughly in half, with **zero quality
change**, by routing the per-clip vision analysis through Anthropic's
[Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
(50% of standard token price; most batches finish in <1h, 24h hard max).

## Why this is the lever (and model choice isn't)

We already use the cheapest model available:

| Surface | Model | Notes |
|---|---|---|
| Vision scene analysis (`worker/processors/generateClipName.ts`) | `claude-haiku-4-5` | Cheapest model in the Claude lineup ($1 / $5 per 1M tokens). Nothing cheaper exists. |
| Audio transcription (`worker/processors/transcribeAudio.ts`) | `gpt-4o-mini-transcribe` | Swapped from `whisper-1` (2026-06-17) — ~half price (~$0.003/min). |

Since the model is already at the floor, the remaining cost levers are *how* we call it.
~95% of the Claude token cost per clip is the **12 image frames** sent to Haiku; the text
prompt and the ≤500-token output are small. Batching halves that with no accuracy impact.

Prompt caching was evaluated and does **not** apply: Haiku's minimum cacheable prefix is
4,096 tokens, the only static content (the tag/shot-type instructions) is ~600 tokens, and
it sits *after* the variable images in the request, so nothing would cache.

## Current state (synchronous)

`worker/processors/processClip.ts` does everything for one clip inline:

1. download from Drive → extract metadata → thumbnail → sprite sheet
2. transcribe audio (`transcribeAudio`) → `audioTalkingCandidate`
3. **call Haiku** (`generateClipName`, 12 frames) → name, description, shotType, tags, `isTalkingToCamera`
4. combine the gate: `hasSpeech = audioTalkingCandidate && aiTalkingCandidate`; force one of `A-Roll`/`B-Roll`
5. write the row, set status `ready`

The Haiku call in step 3 is the only thing we're moving. Nothing in the pipeline is
latency-sensitive — it's a background queue, which is exactly the profile batches are for.

## The core challenge

Batching decouples "submit the Haiku request" from "receive the result," so a job can no
longer finish in a single pass. The work must split across two phases with an intermediate
persisted state.

## Proposed architecture (phased)

### 1. Split the processor into two phases

- **Prepare** (the existing work minus the Haiku call): download, metadata, thumbnail,
  sprite, transcribe, extract the 12 frames. Persist everything already computed. Add a new
  column `audio_has_speech` (boolean) to store the audio-side gate result, because the
  combined A-Roll gate is now resolved later, when the batch result lands. Set status to a
  new intermediate state `analyzing`.
- **Submit**: instead of `messages.create`, push the frames + prompt into a batch request
  with `custom_id = clipId`. **Once submitted, the worker need not retain the frames** — the
  Batch API stores the full request server-side; results come back keyed by `custom_id`, and
  everything else (transcript, metadata, thumbnails) is already persisted on the clip row.

### 2. Submitter job

Accumulates pending clips and fires a batch via `messages.batches.create`, flushing on
whichever comes first — N clips (e.g. 50) or a short timer (e.g. ~2 min). Store the returned
batch id against each clip.

### 3. Poller job

Checks batch status; on `ended`, streams results and, for each `custom_id` (= clipId), runs
the **same** parsing + `applyRollTag` logic that lives in `processClip` today, combines
`audio_has_speech` with the AI's `isTalkingToCamera`, writes
`name`/`description`/`shotType`/`tags`/`hasSpeech`, and flips status to `ready`.

## Schema changes

- Add `analyzing` to `clipStatusEnum` (idempotent migration — prod has no `__drizzle_migrations`
  table, so it must be safe to re-run; see Incident History in `CLAUDE.md`).
- Add `clips.audio_has_speech boolean` (audio-side gate, set in the Prepare phase).
- Track batch membership: either `clips.batch_id` or a small `clip_batches` table.

## Key decisions / risks to confirm before building

- **User-visible latency** — clips sit in `analyzing` for minutes (up to ~1h worst case)
  instead of seconds. Confirm that's acceptable for the library UI and decide how `analyzing`
  renders to users.
- **Per-item failure handling** — a batch reports errors per `custom_id`. Need a retry path
  (or a synchronous fallback for stragglers) so one bad clip doesn't strand others.
- **Health/monitoring** — the `/api/health` queue check should gain a batch-aware signal so a
  stuck or stale batch is visible (mirrors the existing worker/queue health signals).
- **Idempotency** — re-processing a clip (reanalyze) must overwrite cleanly and not leave
  orphaned batch rows.

## Recommended rollout

Prove the plumbing on the **backfill path first**, before touching live ingest:

1. Point `worker/transcribeBackfill.ts` / `worker/reanalyze.ts` at the Batch API for the
   ~3,159-clip A-Roll re-run that's needed anyway once OpenAI billing is restored (those clips
   are currently mislabeled B-Roll — see the A-Roll/B-Roll incident). This validates
   submit → poll → parse → write on a bounded, non-live job.
2. Once proven, move the live `processClip` path to the two-phase model above.

## Effort

Medium — a worker refactor (new state + columns, submitter + poller, idempotent migration,
health signal), not a one-liner. Roughly a focused day plus testing.

## References

- Anthropic Message Batches: https://platform.claude.com/docs/en/build-with-claude/batch-processing
- Current synchronous flow: `worker/processors/processClip.ts`
- Vision call to migrate: `worker/processors/generateClipName.ts`
- Backfill entry points: `worker/transcribeBackfill.ts`, `worker/reanalyze.ts`
- Related: A-Roll/B-Roll transcription outage (OpenAI quota) — must be resolved before the backfill.
