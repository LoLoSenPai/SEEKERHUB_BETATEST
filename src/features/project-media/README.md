# Private project media

## Integration contract

`getProjectMedia(projectId)` is server-only. Call it **after** ownership,
`canViewMetadata`, or valid-invite authorization. It does not authorize viewers.
It returns serializable `ProjectMediaItem[]` (no keys or BigInts) and always
excludes pending/deleting media and soft-deleted projects. Do not cache its result
across users or persist the signed URLs. No public listing endpoint exists.

`AppIcon`, `AppBanner`, `AppScreenshots` in `app-media.tsx` are passive renderers.
The banner fallback is `/images/workspace-atmosphere.png`; no fake screenshots
are rendered. The icon fallback is a Lucide app-window symbol.

`ProjectMediaManager({ projectId, initialMedia })` is an isolated client component,
intended outside the settings form. It handles uploads, replacements, removals,
screenshot reordering and owner-only preview refresh. It uses existing UI tokens.

Private S3 GET URLs expire in 60 seconds and bypass Next image optimization.
All images load eagerly. On a failed/expired image, the isolated image renderer
tries once to renew through the no-store same-origin `/api/project-media/[id]/url`
endpoint. This endpoint rechecks a current session's ownership or metadata access
using the existing access evaluator. An anonymous invite preview can renew only
with a still-valid invite bearer token in the **same-origin** referring page URL;
no token is sent to S3. Missing/stripped referrers fail closed. No new public
project/media listing exists. The manager also has an explicit refresh button.
Soft deletion prevents **new** URLs immediately, but does not revoke previously
issued bearer URLs before their remaining 60-second lifetime expires.

## Lifecycle

Only a raw, single image is accepted by `POST /api/project-media` with query
`projectId`, `kind` and optional `replaceId`. Content-Length is mandatory (browser
File fetch supplies it); chunked requests without a known length are rejected.
Both declared and streamed size are capped before sharp sees the body.
There is no remote URL import and no presigned client PUT for media.

Input: static JPEG/PNG/WebP, <=3 MiB, <=4096 px per side, <=16 million pixels.
Sharp decodes, auto-orients, strips metadata and re-encodes to WebP. Icon is
512-square <=256 KiB; banner is 1600x900 <=1 MiB; screenshot long side <=1920,
<=1 MiB. High-entropy images that cannot meet the cap are rejected.

An exact normalized-byte reservation and a cleanup task commit **before** PUT.
Original inputs exist only in bounded process memory and are never stored.
Serializable reservation with a project lock enforces per-project slots/8 MiB
and shared builder quota, including concurrent APK reservations. Replacements
need room for both physical images until deletion. PUT/commit is not retried;
an ambiguous PUT/DB failure leaves a tracked pending row/task, not an untracked
object. The writer locks project+media during its bounded 20-second PUT.
Pending rows expire after 5 minutes, with one hour of extra cleanup safety.
Abandoned uploads can block a slot/capacity until that cleanup succeeds.

Cron detects expired pending rows and trashed-project retention expiry, then
uses the existing leased deletion worker. Manual admin purge recognizes the
same `ProjectMedia` task type and cannot delete READY or in-flight media.
DELETE plus confirmed HEAD 404 precedes transactional, once-only quota release.
Failed accounting leaves the task retryable and quota charged. Media has a
RESTRICT project FK and project pruning requires zero media rows, so projects
cannot disappear while objects/reservations remain. Project actions need no
changes. Deployment must keep cron cleanup running; exhausted tasks need admin
review through the existing admin task controls.

## Operational boundaries

Apply the additive migration through the normal approved release procedure;
this implementation does not deploy migrations. Use the existing **private,
unversioned** S3/R2 bucket. HEAD 404 proves the current object is gone, not removal
of historical versions in a versioned bucket; versioned storage needs a separate
version-purge policy before physical-byte accounting can claim that guarantee.
The upload body has a 15-second read limit and sharp has bounded pixels/output
and per-encode timeout; upstream request/instance concurrency limits are still
needed for production CPU/RAM protection. Presigned image URLs are bearer links,
not instantly revocable sessions. No antivirus scanning is claimed.
