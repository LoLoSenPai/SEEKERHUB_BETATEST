import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { deviceContextInputSchema } from "@/src/lib/validation";
import { detectDeviceContextFromUserAgent } from "@/src/lib/device/detect";
import { apiError } from "@/src/lib/errors";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = deviceContextInputSchema.parse(await request.json());
    const derived = detectDeviceContextFromUserAgent({
      userAgent: request.headers.get("user-agent") ?? "",
      platformLabel: body.platformLabel,
    });

    const profile = await prisma.deviceProfile.create({
      data: {
        userId: session.user.id,
        browserName: derived.browserName,
        browserVersion: undefined,
        osName: derived.osName,
        osVersion: undefined,
        deviceClass: derived.deviceClass,
        platformLabel: derived.platformLabel,
        isSeeker: derived.isSeeker,
        isSolanaMobileCapable: derived.isSolanaMobileCapable,
        hasMobileWalletAdapterContext:
          derived.hasMobileWalletAdapterContext && body.hasMobileWalletAdapterContext,
        recognitionSource: derived.recognitionSource,
      },
      select: { id: true },
    });

    return NextResponse.json(profile);
  } catch (error) {
    return apiError(error, "Unable to persist device profile.");
  }
}
