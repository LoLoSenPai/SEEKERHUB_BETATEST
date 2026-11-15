"use client";

import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";
import { GripVertical } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { EditorMedia } from "./use-project-media";
import { MediaTile } from "./media-upload-slot";
import { MediaFilePicker } from "./media-file-picker";

type Props = {
  items: EditorMedia[]; disabled: boolean; editingDisabled: boolean;
  onUpload: (file: File, replaceId?: string) => void; onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void; onDragging: (dragging: boolean) => void;
};

function Screenshot({ item, index, disabled, editingDisabled, onUpload, onRemove }: Pick<Props, "disabled" | "editingDisabled" | "onUpload" | "onRemove"> & { item: EditorMedia; index: number }) {
  const { ref, handleRef, isDragging } = useSortable({ id: item.id, index, disabled: disabled || item.saving });
  return <div ref={ref} data-media-id={item.id} className={cn("relative w-28 shrink-0 sm:w-32", isDragging && "z-20")}>
    <MediaTile item={item} label={`screenshot ${index + 1}`} disabled={editingDisabled} className={item.width > item.height ? "aspect-video" : "aspect-[9/16]"} onUpload={onUpload} onRemove={onRemove} />
    <button ref={handleRef} type="button" disabled={disabled || item.saving} aria-label={`Move screenshot ${index + 1}`} title="Drag to reorder. Or press Space, use arrow keys, then Space to drop."
      className="absolute bottom-1 left-1 flex size-11 touch-none cursor-grab items-center justify-center rounded-lg text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:opacity-0">
      <span className="rounded-md bg-black/75 p-1.5"><GripVertical className="size-4" aria-hidden="true" /></span>
    </button>
  </div>;
}

export function SortableScreenshots({ items, disabled, editingDisabled, onUpload, onRemove, onReorder, onDragging }: Props) {
  return <DragDropProvider onDragStart={() => onDragging(true)} onDragEnd={event => {
    onDragging(false);
    if (event.canceled) return;
    const next = move(items, event);
    if (next.some((item, index) => item.id !== items[index]?.id)) onReorder(next.map(item => item.id));
  }}>
    <div className="flex min-w-0 flex-wrap items-start gap-4 pt-1">
      {items.map((item, index) => <Screenshot key={item.id} item={item} index={index} disabled={disabled} editingDisabled={editingDisabled} onUpload={onUpload} onRemove={onRemove} />)}
      {items.length < 5 ? <MediaFilePicker label="Add screenshot" disabled={editingDisabled} className={items.length ? cn("w-28 shrink-0 sm:w-32", items[0].width > items[0].height ? "aspect-video" : "aspect-[9/16]") : "h-28 w-full"} onFile={file => onUpload(file)} /> : null}
    </div>
  </DragDropProvider>;
}
