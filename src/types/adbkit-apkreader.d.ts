declare module "@devicefarmer/adbkit-apkreader" {
  export type AndroidManifest = {
    package?: string;
    versionName?: string | number;
    versionCode?: string | number;
    usesSdk?: {
      minSdkVersion?: string | number;
      targetSdkVersion?: string | number;
    } | null;
  };

  export default class ApkReader {
    static open(path: string): Promise<ApkReader>;
    readManifest(): Promise<AndroidManifest>;
  }
}
