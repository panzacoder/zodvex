import { z } from 'zod'
export class Ticket { constructor(public value: string) {} }
export const ticketCodec = z.codec(z.string(), z.instanceof(Ticket), {
  decode: value => new Ticket(value),
  encode: value => value.value,
})
