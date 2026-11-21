import { describe, expect, it } from "vitest";
import stripNetlifyHtmlAnnotation from "./strip-netlify-html-annotation.js";

const annotation =
  "<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n" +
  "     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=14ee5516-f6df-45cc-9fe8-b7979912107a\n" +
  "     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->";

async function applyFunction(response) {
  return stripNetlifyHtmlAnnotation(new Request("https://example.test/"), {
    next: async () => response,
  });
}

function htmlResponse(body, contentType = "text/html") {
  return new Response(body, {
    headers: { "content-type": contentType },
  });
}

describe("stripNetlifyHtmlAnnotation", () => {
  it("removes the complete exact annotation and preserves surrounding whitespace", async () => {
    const body = `before \n${annotation}\t after`;
    const response = await applyFunction(htmlResponse(body));

    expect(await response.text()).toBe("before \n\t after");
  });

  it("does not match marker phrases across separate comments", async () => {
    const body =
      "<!-- This site is hosted on Netlify. -->" +
      "<p>keep this content</p>" +
      "<!-- Netlify hosting facts for this site: -->";
    const response = await applyFunction(htmlResponse(body));

    expect(await response.text()).toBe(body);
  });

  it("preserves unrelated comments and comments containing only one marker", async () => {
    const body =
      "<!-- ordinary comment -->" +
      "<!-- This site is hosted on Netlify. -->" +
      "<!-- Netlify hosting facts for this site: -->" +
      "<p>content</p>";
    const response = await applyFunction(htmlResponse(body));

    expect(await response.text()).toBe(body);
  });

  it("removes every valid annotation", async () => {
    const body = `<main>${annotation}<p>keep</p>${annotation}</main>`;
    const response = await applyFunction(htmlResponse(body));

    expect(await response.text()).toBe("<main><p>keep</p></main>");
  });

  it("returns HTML without a matching annotation unchanged", async () => {
    const original = htmlResponse("<p>unchanged</p><!-- ordinary -->");
    const response = await applyFunction(original);

    expect(response).toBe(original);
  });

  it.each([
    "text/html",
    "text/html; charset=utf-8",
    "TEXT/HTML; charset=UTF-8",
  ])("processes the HTML media type in %s", async (contentType) => {
    const response = await applyFunction(
      htmlResponse(annotation, contentType),
    );

    expect(await response.text()).toBe("");
  });

  it.each([
    "text/htmlx",
    "application/xhtml+xml",
    undefined,
  ])("does not process non-HTML or missing Content-Type: %s", async (contentType) => {
    const original = htmlResponse(
      annotation,
      contentType ?? "text/html",
    );
    if (contentType === undefined) {
      original.headers.delete("content-type");
    } else {
      original.headers.set("content-type", contentType);
    }

    const response = await applyFunction(original);

    expect(response).toBe(original);
  });

  it("passes non-HTML responses through unchanged", async () => {
    const original = new Response("binary-ish body", {
      headers: { "content-type": "application/octet-stream" },
    });
    const response = await applyFunction(original);

    expect(response).toBe(original);
  });

  it("preserves status, status text, and unrelated headers when modified", async () => {
    const original = new Response(annotation, {
      status: 201,
      statusText: "Created",
      headers: {
        "content-type": "text/html",
        "x-preserved": "yes",
        "content-length": "1234",
        "content-encoding": "gzip",
        etag: '"stale"',
      },
    });
    const response = await applyFunction(original);

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-preserved")).toBe("yes");
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("etag")).toBe(false);
  });
});
