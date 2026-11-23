import { Connection, PublicKey } from "@solana/web3.js";
import { unwrapOption } from "@solana/kit";
import { ExtensionType, TOKEN_2022_PROGRAM_ADDRESS, getExtensionDecoder, getMintDecoder, getMintSize, getMultisigSize, getTokenSize } from "@solana-program/token-2022";
import { getServerEnv } from "@/src/lib/env";
import { logger } from "@/src/lib/logger";

const SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
const SGT_METADATA_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
const SGT_GROUP_MINT_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
const TOKEN_2022_PROGRAM_ID = new PublicKey(TOKEN_2022_PROGRAM_ADDRESS);
const RPC_BATCH_SIZE = 100;
const MINT_BASE_SIZE = getMintSize();
const MINT_INITIALIZED_OFFSET = 45;
const MINT_FREEZE_AUTHORITY_OPTION_OFFSET = 46;
const ACCOUNT_TYPE_OFFSET = getTokenSize();
const MINT_ACCOUNT_TYPE = 1;
const MULTISIG_SIZE = getMultisigSize();
const TLV_HEADER_SIZE = 4;
const mintDecoder = getMintDecoder();
const extensionDecoder = getExtensionDecoder();

function isSeekerMint(mintAddress: string, { owner, data }: { owner: PublicKey; data: Buffer }): boolean {
  if (!owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Unexpected mint program owner");
  if (data.length === MINT_BASE_SIZE) return false; // No extensions.
  if (data.length <= ACCOUNT_TYPE_OFFSET || data.length === MULTISIG_SIZE ||
      data[ACCOUNT_TYPE_OFFSET] !== MINT_ACCOUNT_TYPE ||
      data.subarray(MINT_BASE_SIZE, ACCOUNT_TYPE_OFFSET).some((byte) => byte !== 0) ||
      data.readUInt32LE(0) > 1 || data.readUInt32LE(MINT_FREEZE_AUTHORITY_OPTION_OFFSET) > 1) {
    throw new Error("Invalid Token-2022 mint layout");
  }

  const mint = mintDecoder.decode(data.subarray(0, MINT_BASE_SIZE));
  if (data[MINT_INITIALIZED_OFFSET] !== 1 || !mint.isInitialized || unwrapOption(mint.mintAuthority) !== SGT_MINT_AUTHORITY) {
    return false;
  }

  // Validate the framing: the generated decoder does not enforce exact
  // TLV sizes or uniqueness. Decode only SGT fields so new extensions are tolerated.
  const seen = new Set<number>();
  let hasMetadata = false;
  let hasGroup = false;
  for (let offset = ACCOUNT_TYPE_OFFSET + 1; offset < data.length;) {
    const remaining = data.length - offset;
    if (remaining < 2 || data.readUInt16LE(offset) === ExtensionType.Uninitialized) {
      if (data.subarray(offset).some((byte) => byte !== 0)) throw new Error("Invalid mint TLV padding");
      break;
    }
    if (remaining < TLV_HEADER_SIZE) throw new Error("Incomplete mint TLV header");
    const type = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    const end = offset + TLV_HEADER_SIZE + length;
    if (end > data.length || seen.has(type)) throw new Error("Invalid or duplicate mint TLV entry");
    seen.add(type);

    if (type === ExtensionType.MetadataPointer || type === ExtensionType.TokenGroupMember) {
      const expectedLength = type === ExtensionType.MetadataPointer ? 64 : 72;
      if (length !== expectedLength) throw new Error("Invalid SGT extension size");
      const extension = extensionDecoder.decode(data.subarray(offset, end));
      if (extension.__kind === "MetadataPointer") {
        hasMetadata = unwrapOption(extension.authority) === SGT_MINT_AUTHORITY &&
          unwrapOption(extension.metadataAddress) === SGT_METADATA_ADDRESS;
      } else if (extension.__kind === "TokenGroupMember") {
        hasGroup = extension.mint === mintAddress && extension.group === SGT_GROUP_MINT_ADDRESS;
      }
    }
    offset = end;
  }

  return hasMetadata && hasGroup;
}

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
      const mintAddress = batch[index].toBase58();
      try {
        if (isSeekerMint(mintAddress, accountInfo)) {
          return { verified: true as const, mintAddress };
        }
      } catch (error) {
        logger.warn("sgt.malformed_mint_skipped", { mint: mintAddress, error });
      }
    }
  }

  return { verified: false as const, mintAddress: null };
}
