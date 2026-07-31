"use client";

import { useState, useSyncExternalStore } from "react";
import { detectDeviceContextFromUserAgent } from "@/src/lib/device/detect";
import type { DeviceContext } from "@/src/lib/device/types";

type DeviceProfileResponse = {
  id: string;
};

const UNKNOWN_DEVICE_CONTEXT: DeviceContext = {
  deviceClass: "UNKNOWN",
  isSeeker: false,
  isSolanaMobileCapable: false,
  hasMobileWalletAdapterContext: false,
  recognitionSource: "NONE",
};

let cachedDeviceKey = "";
let cachedDeviceContext = UNKNOWN_DEVICE_CONTEXT;

function subscribe() {
  return () => {};
}

function getStoredDeviceProfileId() {
  try {
    return sessionStorage.getItem("seekerhub-device-profile-id");
  } catch {
    return null;
  }
}

function getBrowserDeviceContext() {
  const key = `${navigator.userAgent}\n${navigator.platform}`;
  if (key !== cachedDeviceKey) {
    cachedDeviceKey = key;
    cachedDeviceContext = detectDeviceContextFromUserAgent({
      userAgent: navigator.userAgent,
      platformLabel: navigator.platform,
    });
  }
  return cachedDeviceContext;
}

export function useDeviceContext() {
  const storedDeviceProfileId = useSyncExternalStore(subscribe, getStoredDeviceProfileId, () => null);
  const context = useSyncExternalStore(subscribe, getBrowserDeviceContext, () => UNKNOWN_DEVICE_CONTEXT);
  const [persistedDeviceProfileId, setPersistedDeviceProfileId] = useState<string | null>(null);
  const deviceProfileId = persistedDeviceProfileId ?? storedDeviceProfileId;

  async function persistDeviceProfile() {
    if (deviceProfileId) return deviceProfileId;

    const response = await fetch("/api/device-profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(context),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as DeviceProfileResponse;
    sessionStorage.setItem("seekerhub-device-profile-id", data.id);
    setPersistedDeviceProfileId(data.id);
    return data.id;
  }

  return {
    context,
    deviceProfileId,
    persistDeviceProfile,
  };
}
