import Image from "next/image";

type ThumbProps = {
  // A public storage URL, or null when the post has no photo to show
  src: string | null;
  alt: string;
  size?: number;
};

// Square photo thumbnail for tables and pickers
export default function Thumb({ src, alt, size = 48 }: ThumbProps) {
  const box = { width: size, height: size };
  if (!src) {
    return (
      <span
        role="img"
        aria-label={alt ? `${alt} (no photo)` : "No photo"}
        style={box}
        className="inline-block shrink-0 rounded-lg border border-dashed border-line bg-canvas"
      />
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={box}
      className="shrink-0 rounded-lg border border-line bg-canvas object-cover"
    />
  );
}
