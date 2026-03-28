import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMetadataPointerState,
  getTokenGroupMemberState,
  unpackMint,
} from "@solana/spl-token";
import { getServerEnv } from "@/src/lib/env";

const SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
const SGT_METADATA_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
const SGT_GROUP_MINT_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";

export async function verifySeekerGenesisOwnership(address: string) {
  const env = getServerEnv();
  const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  const owner = new PublicKey(address);

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_2022_PROGRAM_ID,
  });

  if (tokenAccounts.value.length === 0) {
    return { verified: false as const, mintAddress: null };
  }

  const mintKeys = tokenAccounts.value
    .map((account) => account.account.data.parsed.info.mint as string | undefined)
    .filter((mint): mint is string => Boolean(mint))
    .map((mint) => new PublicKey(mint));

  const mintInfos = await connection.getMultipleAccountsInfo(mintKeys);

  for (const [index, accountInfo] of mintInfos.entries()) {
    if (!accountInfo) continue;

    const mint = unpackMint(mintKeys[index], accountInfo, TOKEN_2022_PROGRAM_ID);
    const metadataPointer = getMetadataPointerState(mint);
    const tokenGroupMember = getTokenGroupMemberState(mint);

    const hasMintAuthority = mint.mintAuthority?.toBase58() === SGT_MINT_AUTHORITY;
    const hasMetadata =
      metadataPointer?.authority?.toBase58() === SGT_MINT_AUTHORITY &&
      metadataPointer?.metadataAddress?.toBase58() === SGT_METADATA_ADDRESS;
    const hasGroup = tokenGroupMember?.group?.toBase58() === SGT_GROUP_MINT_ADDRESS;

    if (hasMintAuthority && hasMetadata && hasGroup) {
      return {
        verified: true as const,
        mintAddress: mint.address.toBase58(),
      };
    }
  }

  return { verified: false as const, mintAddress: null };
}
