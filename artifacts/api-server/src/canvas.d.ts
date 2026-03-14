declare module "canvas" {
  export function createCanvas(width: number, height: number): any;
  export function loadImage(src: string | Buffer): Promise<any>;
  export function registerFont(path: string, options: { family: string; weight?: string; style?: string }): void;
}
