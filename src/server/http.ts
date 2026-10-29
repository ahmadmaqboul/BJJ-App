/**
 * Reads a JSON request body, treating a missing or malformed body as an empty
 * object. Every field comes back optional, which is what the route validation
 * assumes — a client can always omit or mistype anything.
 */
export async function readJson<T>(req: {
  json: <X>() => Promise<X>;
}): Promise<Partial<T>> {
  try {
    const parsed = await req.json<Partial<T> | null>();
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
