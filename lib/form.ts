/**
 * Parse multipart form data from a request.
 *
 * workerd's streaming formData() parser can throw
 * "No initial boundary string (or you have a truncated message)" for
 * browser-uploaded bodies (notably iOS WebKit). Buffering the whole body
 * first and parsing from memory avoids that path.
 */
export async function parseFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") || "";
  const buf = await request.arrayBuffer();
  const inner = new Request(request.url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: buf,
  });
  return inner.formData();
}
