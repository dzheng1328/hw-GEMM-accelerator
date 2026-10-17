import { useEffect, useRef } from "react";
import { IMAGE_SIDE } from "../reference/pack";

export interface ExampleImage {
  name: string;
  /** 3072 bytes, channel-first */
  pixels: Uint8Array;
}

/** One example per CIFAR-10 class: the number of tiles to reserve space for while the examples load. */
export const EXAMPLE_COUNT = 10;

export interface ImagePickerProps {
  examples: ExampleImage[];
  /** true while the examples are loading: inert placeholders hold the grid's space so the page below does not jump */
  loading?: boolean;
  selected: number | null;
  uploadName: string | null;
  disabled?: boolean;
  onExample(index: number): void;
  onUpload(file: File): void;
}

/** Draws a channel-first 32x32 RGB image onto a canvas. Does nothing where canvas is not available. */
export function drawThumb(canvas: HTMLCanvasElement | null, pixels: Uint8Array): void {
  if (!canvas || typeof ImageData === "undefined") return;
  try {
    const context = canvas.getContext("2d");
    if (!context) return;
    const plane = IMAGE_SIDE * IMAGE_SIDE;
    const rgba = new Uint8ClampedArray(plane * 4);
    for (let i = 0; i < plane; i++) {
      rgba[i * 4] = pixels[i]!;
      rgba[i * 4 + 1] = pixels[plane + i]!;
      rgba[i * 4 + 2] = pixels[2 * plane + i]!;
      rgba[i * 4 + 3] = 255;
    }
    context.putImageData(new ImageData(rgba, IMAGE_SIDE, IMAGE_SIDE), 0, 0);
  } catch {
    // a thumbnail is decoration; the button still has its name
  }
}

function Thumb({ pixels }: { pixels: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => drawThumb(ref.current, pixels), [pixels]);
  return <canvas ref={ref} width={IMAGE_SIDE} height={IMAGE_SIDE} aria-hidden="true" />;
}

export function ImagePicker({ examples, loading, selected, uploadName, disabled, onExample, onUpload }: ImagePickerProps) {
  return (
    <div className="live-picker">
      <div className="live-examples" role="group" aria-label="Example images">
        {loading
          ? Array.from({ length: EXAMPLE_COUNT }, (_, i) => (
              <button key={i} type="button" className="live-example-placeholder" aria-hidden="true" tabIndex={-1} disabled>
                <canvas width={IMAGE_SIDE} height={IMAGE_SIDE} />
                <span>&nbsp;</span>
              </button>
            ))
          : null}
        {examples.map((example, i) => (
          <button
            key={example.name}
            type="button"
            aria-label={`Example: ${example.name}`}
            aria-pressed={selected === i}
            disabled={disabled}
            onClick={() => onExample(i)}
          >
            <Thumb pixels={example.pixels} />
            <span>{example.name}</span>
          </button>
        ))}
      </div>
      <label className="live-upload">
        <span>Upload your own image</span>
        <input
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = "";
          }}
        />
      </label>
      {uploadName ? <p className="live-upload-name">Using your image: {uploadName}</p> : null}
    </div>
  );
}
