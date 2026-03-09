declare module 'qrcode' {
  interface QRCodeToStringOptions {
    type?: 'utf8' | 'svg' | 'terminal';
    small?: boolean;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
  }

  interface QRCode {
    toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
    toDataURL(text: string, options?: Record<string, unknown>): Promise<string>;
    toFile(path: string, text: string, options?: Record<string, unknown>): Promise<void>;
  }

  const qrcode: QRCode;
  export default qrcode;
}
