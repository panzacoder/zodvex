import { z } from "zod";

// A deterministic runtime type, not encryption or Hotpot's SensitiveField.
export class SecretText {
  constructor(value) { this.value = value; }
  reveal() { return this.value; }
}
export const secretCodec = z.codec(z.string(), z.instanceof(SecretText), {
  decode: value => new SecretText(value),
  encode: value => value.reveal(),
});
export const validatedTextCodec = z.codec(z.string(), z.string().min(3), {
  decode: value => value,
  encode: value => value,
});
