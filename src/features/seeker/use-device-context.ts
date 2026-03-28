"use client";

import { useMemo, useState } from "react";
import { detectDeviceContextFromUserAgent } from "@/src/lib/device/detect";
import type { DeviceContext } from "@/src/lib/device/types";

type DeviceProfileResponse = {
  id: string;
};

export function useDeviceContext(verifiedSeeker = false) {
  const [deviceProfileId, setDeviceProfileId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return sessionStorage.getItem("seekerhub-device-profile-id");
  });

  const context = useMemo<DeviceContext>(() => {
    if (typeof navigator === "undefined") {
      return {
        deviceClass: "UNKNOWN",
        isSeeker: false,
        isSolanaMobileCapable: false,
        hasMobileWalletAdapterContext: false,
        recognitionSource: "NONE",
      };
    }

    return detectDeviceContextFromUserAgent({
      userAgent: navigator.userAgent,
      platformLabel: navigator.platform,
      verifiedSeeker,
    });
  }, [verifiedSeeker]);

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
    setDeviceProfileId(data.id);
    return data.id;
  }

  return {
    context,
    deviceProfileId,
    persistDeviceProfile,
  };
}
