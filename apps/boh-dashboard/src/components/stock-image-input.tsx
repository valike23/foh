"use client";
import { useState } from "react";
export function StockImageInput({ name, label, initial = "" }: { name: string; label: string; initial?: string }) {
  const [image, setImage] = useState(initial), [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setError("Choose a PNG, JPEG or WebP image up to 10 MB."); return; }
    const url = URL.createObjectURL(file);
    try {
      const picture = new Image(); picture.src = url; await picture.decode();
      const scale = Math.min(1, 480 / Math.max(picture.width, picture.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(picture.width * scale)); canvas.height = Math.max(1, Math.round(picture.height * scale));
      canvas.getContext("2d")!.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL("image/webp", 0.75);
      if (value.length > 300000) throw new Error("Image is too detailed. Choose a smaller image.");
      setImage(value);
    } catch { setError("Unable to load this image. Try a smaller PNG, JPEG or WebP."); } finally { URL.revokeObjectURL(url); }
  }
  return <div><label>{label} (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const input = e.currentTarget; input.setCustomValidity("Please wait for the image to finish loading."); void upload(input.files?.[0]).finally(() => input.setCustomValidity("")); }} /></label><input type="hidden" name={name} value={image} />{image && <div><img src={image} alt={label + " preview"} width={96} height={96} style={{ objectFit: "cover", borderRadius: 8 }} /><button type="button" className="text-action" onClick={() => setImage("")}>Remove image</button></div>}{error && <p role="alert">{error}</p>}</div>;
}
