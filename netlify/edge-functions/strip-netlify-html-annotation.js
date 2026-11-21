const htmlComment = /<!--[\s\S]*?-->/g;

export default async function stripNetlifyHtmlAnnotation(_request, context) {
  const response = await context.next();
  const contentType = response.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0].trim();

  if (mediaType.toLowerCase() !== "text/html") {
    return response;
  }

  const body = await response.clone().text();
  const cleanBody = body.replace(htmlComment, (comment) =>
    comment.includes("This site is hosted on Netlify.") &&
    comment.includes("Netlify hosting facts for this site:")
      ? ""
      : comment,
  );

  if (cleanBody === body) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");

  return new Response(cleanBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
