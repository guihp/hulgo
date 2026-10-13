declare module "heic-convert" {
  type Options = {
    buffer: Uint8Array | ArrayBuffer;
    format: "JPEG" | "PNG";
    quality?: number;
  };
  export default function heicConvert(options: Options): Promise<ArrayBuffer>;
}
