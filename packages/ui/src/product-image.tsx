"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";

export function ProductImage({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState<string>();
  return <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-secondary/40">
    {src && failed !== src
      ? <img src={src} alt={name} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(src)} />
      : <div className="grid justify-items-center gap-2 text-sm text-muted-foreground"><ImageIcon size={32} aria-hidden="true" /><span>No image</span></div>}
  </div>;
}
