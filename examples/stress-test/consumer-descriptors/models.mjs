import { z } from "zod";
import { defineZodModel, zx } from "zodvex";
import { initialized } from "./counters.mjs";
import { secretCodec } from "./codecs.mjs";

export function probeModel() {
  initialized.models.push("probe");
  return defineZodModel("probe", {
    name: z.string(), createdAt: zx.date(), secret: secretCodec,
    updatedAt: z.optional(zx.date()),
    nested: z.object({ history: z.array(zx.date()), note: z.string() }),
  });
}

export function backgroundModel(index, width = 32) {
  const name = `unused${index}`;
  initialized.models.push(name);
  const fields = {};
  for (let field = 0; field < width - 4; field++) {
    fields[`f${field}`] = field % 2 ? z.number() : z.string();
  }
  return defineZodModel(name, {
    ...fields, createdAt: zx.date(), secret: secretCodec,
    updatedAt: z.optional(zx.date()),
    nested: z.object({ history: z.array(zx.date()), note: z.string() }),
  });
}
