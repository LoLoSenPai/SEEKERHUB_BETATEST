import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { deviceContextInputSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = deviceContextInputSchema.parse(await request.json());

    const profile = await prisma.deviceProfile.create({
      data: {
        userId: session.user.id,
        browserName: body.browserName,
        browserVersion: body.browserVersion,
        osName: body.osName,
        osVersion: body.osVersion,
        deviceClass: body.deviceClass,
        platformLabel: body.platformLabel,
        isSeeker: body.isSeeker,
        isSolanaMobileCapable: body.isSolanaMobileCapable,
        hasMobileWalletAdapterContext: body.hasMobileWalletAdapterContext,
        recognitionSource: body.recognitionSource,
      },
      select: { id: true },
    });

    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to persist device profile.",
      },
      { status: 400 },
    );
  }
}
