import { z } from "zod";

const messageUpdate = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: z
      .object({
        message_id: z.number().int(),
        date: z.number(),
        text: z.string(),
        chat: z
          .object({
            id: z.number().int(),
            type: z.enum(["private", "group", "supergroup"]),
          })
          .passthrough(),
        from: z
          .object({
            id: z.number().int().safe().positive(),
            is_bot: z.literal(false),
            first_name: z.string(),
            last_name: z.string().optional(),
            username: z.string().optional(),
          })
          .passthrough(),
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
      .passthrough(),
  })
  .passthrough();

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
  if (!messageUpdate.safeParse(update).success)
    return new Response("Ignored", { status: 200 });
  return body;
}
