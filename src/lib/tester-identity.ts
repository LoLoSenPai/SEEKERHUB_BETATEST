type TesterIdentity = {
  isAnonymous?: boolean | null;
  email: string;
  wallets?: { address: string; isPrimary?: boolean }[];
};

export function getTesterIdentityLabel(user: TesterIdentity) {
  if (user.isAnonymous) return "Guest tester";
  if (!user.email.endsWith("@seekerhub.local")) return user.email;
  const wallet = user.wallets?.find((entry) => entry.isPrimary) ?? user.wallets?.[0];
  return wallet ? `Wallet ${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}` : "Tester account";
}
