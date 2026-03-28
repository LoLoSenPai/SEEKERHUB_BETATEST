import type { DeviceContext } from "@/src/lib/device/types";

function classifyDevice(ua: string): DeviceContext["deviceClass"] {
  if (/iPad|Tablet/i.test(ua)) return "TABLET";
  if (/Mobile|Android|iPhone/i.test(ua)) return "MOBILE";
  if (!ua) return "UNKNOWN";
  return "DESKTOP";
}

function detectBrowser(ua: string) {
  if (/Phantom/i.test(ua)) return "Phantom";
  if (/Solflare/i.test(ua)) return "Solflare";
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) return "Chrome";
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return "Safari";
  if (/Firefox/i.test(ua)) return "Firefox";
  return undefined;
}

function detectOs(ua: string) {
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return undefined;
}

export function detectDeviceContextFromUserAgent({
  userAgent,
  platformLabel,
  verifiedSeeker = false,
}: {
  userAgent: string;
  platformLabel?: string;
  verifiedSeeker?: boolean;
}): DeviceContext {
  const browserName = detectBrowser(userAgent);
  const osName = detectOs(userAgent);
  const isAndroid = osName === "Android";
  const inWalletBrowser = /Phantom|Solflare|Backpack|Glow|Nightly/i.test(userAgent);
  const isChromeAndroid = isAndroid && /Chrome/i.test(userAgent) && !/Edg|OPR/i.test(userAgent);
  const seekerHint = /Seeker/i.test(userAgent);
  const isSolanaMobileCapable = isChromeAndroid || inWalletBrowser;
  const hasMobileWalletAdapterContext = isSolanaMobileCapable;
  const isSeeker = verifiedSeeker || seekerHint;

  let recognitionSource: DeviceContext["recognitionSource"] = "NONE";
  if (verifiedSeeker) {
    recognitionSource = "VERIFIED_WALLET_SGT";
  } else if (seekerHint || isSolanaMobileCapable) {
    recognitionSource = hasMobileWalletAdapterContext ? "WALLET_CONTEXT" : "USER_AGENT";
  }

  return {
    browserName,
    osName,
    platformLabel,
    deviceClass: classifyDevice(userAgent),
    isSeeker,
    isSolanaMobileCapable,
    hasMobileWalletAdapterContext,
    recognitionSource,
  };
}
