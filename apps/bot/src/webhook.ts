import { z } from "zod";

const sender = z
  .object({
    id: z.number().int().safe().positive(),
    is_bot: z.literal(false),
    first_name: z.string().max(256),
    last_name: z.string().max(256).optional(),
    username: z.string().max(128).optional(),
  })
  .passthrough();
const chat = z
  .object({
    id: z
      .number()
      .int()
      .safe()
      .refine((id) => id !== 0),
    type: z.enum(["private", "group", "supergroup", "channel"]),
  })
  .passthrough();
const message = z
  .object({
    message_id: z.number().int().safe().positive(),
    date: z.number().int().safe().nonnegative(),
    text: z.string(),
    chat: chat.refine((value) => value.type !== "channel"),
    from: sender,
    entities: z
      .array(
        z
          .object({
            type: z.string(),
            offset: z.number().int().nonnegative(),
            length: z.number().int().nonnegative(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();
const callback = z
  .object({
    id: z.string().min(1).max(256),
    from: sender,
    chat_instance: z.string().min(1).max(256),
    data: z
      .string()
      .refine((data) => {
        const size = new TextEncoder().encode(data).length;
        return size >= 1 && size <= 64;
      })
      .optional(),
    // The original keyboard message is normally FROM THE BOT. Its sender must
    // never be used as the callback actor. date=0 also covers inaccessible messages.
    message: z
      .object({
        message_id: z.number().int().safe().positive(),
        date: z.number().int().safe().nonnegative(),
        chat,
      })
      .passthrough()
      .optional(),
    inline_message_id: z.string().min(1).max(256).optional(),
  })
  .passthrough()
  .refine((value) => !!value.message !== !!value.inline_message_id);
const supportedUpdate = z.union([
  z
    .object({
      update_id: z.number().int().safe().nonnegative(),
      message,
      callback_query: z.never().optional(),
    })
    .passthrough(),
  z
    .object({
      update_id: z.number().int().safe().nonnegative(),
      message: z.never().optional(),
      callback_query: callback,
    })
    .passthrough(),
]);

// Read a bounded body only after webhook authentication. Unsupported updates,
// bots, and missing/invalid senders are acknowledged without any identity call.
export async function readUpdate(request: Request): Promise<string | Response> {
  if (!request.body) return new Response("Invalid update", { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) {
      await reader.cancel();
      return new Response("Update too large", { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body = new TextDecoder().decode(bytes);
  let update: unknown;
  try {
    update = JSON.parse(body);
  } catch {
    return new Response("Invalid update", { status: 400 });
  }
  if (!supportedUpdate.safeParse(update).success)
    return new Response("Ignored", { status: 200 });
  return body;
}
