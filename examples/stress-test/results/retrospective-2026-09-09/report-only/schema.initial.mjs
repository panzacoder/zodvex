// Hand-authored, neutral workload. Only aggregate report values informed this file.
import * as z from 'zod';
import { defineZodModel, zx } from 'zodvex';
import { defineZodSchema } from 'zodvex/server';

export class EncodedText {
  constructor(value) { this.value = value; }
  toWire() { return this.value; }
}

// Tiny behaviorful callbacks are deliberate: the report cannot reveal real closures.
const encodedText = () => z.codec(z.string(), z.instanceof(EncodedText), {
  decode: (value) => new EncodedText(value),
  encode: (value) => value.toWire(),
});

const level = z.enum(['low', 'normal', 'high']);
const mode = z.enum(['manual', 'automatic']);
const source = z.enum(['local', 'remote']);
const enabled = z.boolean();
const visible = z.boolean();
const locked = z.boolean();
const active = z.boolean();
const complete = z.boolean();

// Shared definitions represent modest reuse across distinct model families.
const position = z.object({
  row: z.number(),
  column: z.number(),
  label: z.string().optional(),
}).strict();
const contact = z.object({
  label: z.string(),
  address: z.string().optional(),
  note: z.string().nullable(),
}).strict();
const span = z.object({
  lower: z.number(),
  upper: z.number(),
  unit: z.string().optional(),
}).strict();
const stamp = z.object({
  revision: z.number(),
  tag: z.string().optional(),
  note: z.string().nullable().optional(),
}).strict();

const models = {
  table01: defineZodModel('table01', {
    parentId: zx.id('table02'),
    label: z.string().min(1),
    content: encodedText(),
    state: z.enum(['draft', 'ready', 'done']),
    quantity: z.number().min(0),
    note: z.string().optional(),
    detail: z.object({
      location: position.optional(),
      priority: level,
      choice: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('plain'), value: z.string(), hint: z.string().optional() }),
        z.object({ kind: z.literal('sized'), value: z.number(), hint: z.string().optional() }),
      ]),
    }),
    fallback: z.union([z.literal('unset'), z.null()]),
  }),
  table02: defineZodModel('table02', {
    parentId: zx.id('table03'),
    label: z.string().min(1),
    content: encodedText(),
    state: z.enum(['open', 'closed']),
    quantity: z.number().max(1000),
    note: z.string().optional(),
    detail: z.object({
      contact: contact.optional(),
      enabled,
      choice: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('named'), value: z.string(), extra: z.string().optional() }),
        z.object({ kind: z.literal('counted'), value: z.number(), extra: z.string().optional() }),
      ]),
    }),
    fallback: z.union([z.literal('empty'), z.null()]),
  }),
  table03: defineZodModel('table03', {
    parentId: zx.id('table04'),
    label: z.string().min(1),
    content: encodedText(),
    state: z.enum(['pending', 'accepted', 'rejected']),
    quantity: z.number().min(0),
    note: z.string().optional(),
    detail: z.object({
      span: span.optional(),
      visible,
      choice: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('text'), value: z.string(), extra: z.string().optional() }),
        z.object({ kind: z.literal('amount'), value: z.number(), extra: z.string().optional() }),
      ]),
    }),
    fallback: z.union([z.literal('missing'), z.null()]),
  }),
  table04: defineZodModel('table04', {
    parentId: zx.id('table05'),
    label: z.string().max(200),
    content: encodedText(),
    state: z.enum(['new', 'processed']),
    quantity: z.number().min(0),
    note: z.string().optional(),
    detail: z.object({
      stamp: stamp.optional(),
      locked,
      choice: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('single'), value: z.string(), extra: z.string().optional() }),
        z.object({ kind: z.literal('total'), value: z.number(), extra: z.string().optional() }),
      ]),
    }),
    fallback: z.union([z.literal('none'), z.null()]),
  }),
  table05: defineZodModel('table05', {
    parentId: zx.id('table06'),
    label: z.string(),
    content: encodedText().optional(),
    state: z.enum(['queued', 'running', 'finished']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).strict().optional(),
      active,
      remark: z.string().optional(),
    }),
    fallback: z.union([z.literal('blank'), z.null()]),
  }),
  table06: defineZodModel('table06', {
    parentId: zx.id('table07'),
    label: z.string(),
    content: encodedText().optional(),
    state: z.enum(['idle', 'busy']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).strict().optional(),
      complete,
      remark: z.string().optional(),
    }),
    fallback: z.union([z.literal('default'), z.null()]),
  }),
  table07: defineZodModel('table07', {
    parentId: zx.id('table08'),
    label: z.string(),
    content: encodedText().optional(),
    state: z.enum(['initial', 'final']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).strict().optional(),
      mode,
      remark: z.string().optional(),
    }),
    fallback: z.union([z.literal('unknown'), z.null()]),
  }),
  table08: defineZodModel('table08', {
    parentId: zx.id('table09'),
    label: z.string(),
    content: encodedText(),
    state: z.enum(['before', 'after']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).strict().optional(),
      source,
      remark: z.string().optional(),
    }),
    fallback: z.union([z.literal('absent'), z.null()]),
  }),
  table09: defineZodModel('table09', {
    parentId: zx.id('table10'),
    label: z.string(),
    content: encodedText(),
    state: z.enum(['short', 'long']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).optional(),
      labels: z.array(z.string()),
      remark: z.string().optional(),
    }),
    fallback: z.union([z.literal('void'), z.null()]),
  }),
  table10: defineZodModel('table10', {
    parentId: zx.id('table11'),
    label: z.string(),
    content: encodedText(),
    state: z.enum(['basic', 'extended']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).optional(),
      values: z.array(z.number()),
      remark: z.string().optional(),
    }),
    fallback: z.literal('stable'),
  }),
  table11: defineZodModel('table11', {
    origin: z.string(),
    label: z.string(),
    content: encodedText(),
    state: z.enum(['public', 'internal']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).optional(),
      extra: z.unknown(),
      remark: z.string().optional(),
    }),
    fallback: z.literal('local'),
  }),
  table12: defineZodModel('table12', {
    origin: z.string(),
    label: z.string(),
    content: z.string().optional(),
    state: z.enum(['light', 'dark']),
    quantity: z.number(),
    note: z.string().optional(),
    detail: z.object({
      grouping: z.object({ name: z.string(), alias: z.string().optional(), note: z.string().nullable() }).optional(),
      extra: z.unknown(),
      remark: z.string().optional(),
    }),
    fallback: z.literal('neutral'),
  }),
};

export default defineZodSchema(models);
