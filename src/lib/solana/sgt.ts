import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMetadataPointerState, getTokenGroupMemberState, unpackMint } from "@solana/spl-token";
import { getServerEnv } from "@/src/lib/env";
import { logger } from "@/src/lib/logger";

const SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
const SGT_METADATA_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
const SGT_GROUP_MINT_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
const RPC_BATCH_SIZE = 100;

export class SeekerVerificationUnavailableError extends Error {
  constructor() {
    super("Seeker verification is temporarily unavailable. Try again shortly.");
  }
}

export async function verifySeekerGenesisOwnership(address: string) {
  const connection = new Connection(getServerEnv().SOLANA_RPC_URL, "confirmed");
  const owner = new PublicKey(address);

  let tokenAccounts;
  try {
    tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
  } catch (error) {
    logger.error("sgt.token_accounts_failed", { error });
    throw new SeekerVerificationUnavailableError();
  }

  const positiveMints = new Set<string>();
  for (const account of tokenAccounts.value) {
    const info = account.account.data.parsed.info as {
      mint?: string;
      tokenAmount?: { amount?: string };
    };
    if (info.mint && info.tokenAmount?.amount && BigInt(info.tokenAmount.amount) > 0n) positiveMints.add(info.mint);
  }

  const mintKeys = [...positiveMints].map((mint) => new PublicKey(mint));
  for (let offset = 0; offset < mintKeys.length; offset += RPC_BATCH_SIZE) {
    const batch = mintKeys.slice(offset, offset + RPC_BATCH_SIZE);
    let mintInfos;
    try {
      mintInfos = await connection.getMultipleAccountsInfo(batch);
    } catch (error) {
      logger.error("sgt.mint_batch_failed", { offset, error });
      throw new SeekerVerificationUnavailableError();
    }

    for (const [index, accountInfo] of mintInfos.entries()) {
      if (!accountInfo) continue;
      try {
        const mint = unpackMint(batch[index], accountInfo, TOKEN_2022_PROGRAM_ID);
        const metadataPointer = getMetadataPointerState(mint);
        const tokenGroupMember = getTokenGroupMemberState(mint);
        const hasMintAuthority = mint.mintAuthority?.toBase58() === SGT_MINT_AUTHORITY;
        const hasMetadata =
          metadataPointer?.authority?.toBase58() === SGT_MINT_AUTHORITY &&
          metadataPointer?.metadataAddress?.toBase58() === SGT_METADATA_ADDRESS;
        const hasGroup = tokenGroupMember?.group?.toBase58() === SGT_GROUP_MINT_ADDRESS;

        if (hasMintAuthority && hasMetadata && hasGroup) {
          return { verified: true as const, mintAddress: mint.address.toBase58() };
        }
      } catch (error) {
        logger.warn("sgt.malformed_mint_skipped", { mint: batch[index].toBase58(), error });
      }
    }
  }

  return { verified: false as const, mintAddress: null };
}
