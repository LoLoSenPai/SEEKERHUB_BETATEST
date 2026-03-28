import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { verifySeekerGenesisOwnership } from "@/src/lib/solana/sgt";
import { walletChallengeSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = walletChallengeSchema.parse(await request.json());
    const wallet = await prisma.wallet.findFirst({
      where: {
        userId: session.user.id,
        address: body.address,
      },
    });

    if (!wallet) {
      return NextResponse.json({ error: "Link the wallet before Seeker verification." }, { status: 404 });
    }

    const result = await verifySeekerGenesisOwnership(body.address);

    if (result.verified) {
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          seekerGenesisVerifiedAt: new Date(),
          seekerGenesisMintAddress: result.mintAddress,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to verify Seeker ownership.",
      },
      { status: 400 },
    );
  }
}
