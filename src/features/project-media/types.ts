export type ProjectMediaKind = "ICON" | "BANNER" | "SCREENSHOT";

export type ProjectMediaItem = {
  id: string;
  kind: ProjectMediaKind;
  url: string;
  width: number;
  height: number;
  position: number;
};
