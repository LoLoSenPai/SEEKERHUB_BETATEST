export type DeviceContext = {
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  osVersion?: string;
  deviceClass: "MOBILE" | "TABLET" | "DESKTOP" | "UNKNOWN";
  platformLabel?: string;
  isSeeker: boolean;
  isSolanaMobileCapable: boolean;
  hasMobileWalletAdapterContext: boolean;
  recognitionSource: "NONE" | "USER_AGENT" | "WALLET_CONTEXT" | "VERIFIED_WALLET_SGT";
};
