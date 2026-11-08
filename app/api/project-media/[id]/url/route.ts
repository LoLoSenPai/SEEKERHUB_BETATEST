import { mediaApiError, mediaJson } from "@/src/features/project-media/http";
import { mediaIdSchema, parseMediaInput } from "@/src/features/project-media/validation";
import { authorizeMediaRenewal } from "@/src/features/project-media/view-access";
import { createSignedMediaUrl } from "@/src/lib/storage/project-media";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseMediaInput(mediaIdSchema, (await context.params).id);
    const key = await authorizeMediaRenewal(request, id);
    return mediaJson({ url: await createSignedMediaUrl(key) });
  } catch (error) { return mediaApiError(error); }
}
