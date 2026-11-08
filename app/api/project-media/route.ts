import { authorizeMediaOwner, mediaApiError, mediaJson } from "@/src/features/project-media/http";
import { normalizeProjectMedia } from "@/src/features/project-media/normalize";
import { getProjectMedia } from "@/src/features/project-media/queries";
import { deleteProjectMedia, reorderProjectMedia, storeProjectMedia } from "@/src/features/project-media/service";
import { MAX_MEDIA_INPUT_BYTES, mediaIdSchema, parseMediaInput, readBoundedBody, reorderMediaSchema, uploadMediaSchema } from "@/src/features/project-media/validation";
import { AppError } from "@/src/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const projectId = parseMediaInput(mediaIdSchema, new URL(request.url).searchParams.get("projectId"));
    await authorizeMediaOwner(request, projectId, false);
    return mediaJson({ media: await getProjectMedia(projectId) });
  } catch (error) { return mediaApiError(error); }
}

// Raw one-image body, not multipart: reject length before any image/body parsing.
export async function POST(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const input = parseMediaInput(uploadMediaSchema, {
      projectId: params.get("projectId"), kind: params.get("kind"),
      ...(params.has("replaceId") ? { replaceId: params.get("replaceId") } : {}),
    });
    const userId = await authorizeMediaOwner(request, input.projectId);
    if (!["image/jpeg", "image/png", "image/webp"].includes(request.headers.get("content-type") ?? "")) throw new AppError("Use a JPEG, PNG or WebP image.", 415, "INVALID_MEDIA_TYPE");
    const body = await readBoundedBody(request, MAX_MEDIA_INPUT_BYTES);
    const normalized = await normalizeProjectMedia(body, input.kind);
    await storeProjectMedia({ userId, ...input, ...normalized });
    return mediaJson({ media: await getProjectMedia(input.projectId) });
  } catch (error) { return mediaApiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const projectId = parseMediaInput(mediaIdSchema, params.get("projectId"));
    const id = parseMediaInput(mediaIdSchema, params.get("id"));
    const userId = await authorizeMediaOwner(request, projectId);
    await deleteProjectMedia(userId, projectId, id);
    return mediaJson({ media: await getProjectMedia(projectId) });
  } catch (error) { return mediaApiError(error); }
}

export async function PATCH(request: Request) {
  try {
    // Authorize the URL project before reading even the small JSON body.
    const projectId = parseMediaInput(mediaIdSchema, new URL(request.url).searchParams.get("projectId"));
    const userId = await authorizeMediaOwner(request, projectId);
    const body = await readBoundedBody(request, 2048);
    let json: unknown;
    try { json = JSON.parse(body.toString("utf8")); } catch { throw new AppError("Invalid media request.", 400, "INVALID_MEDIA_REQUEST"); }
    const input = parseMediaInput(reorderMediaSchema, json);
    if (input.projectId !== projectId) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
    await reorderProjectMedia(userId, projectId, input.ids);
    return mediaJson({ media: await getProjectMedia(projectId) });
  } catch (error) { return mediaApiError(error); }
}
