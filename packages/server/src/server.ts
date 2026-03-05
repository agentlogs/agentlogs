import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

const DOCS_URL = "vibeinsights.mintlify.dev";
const CUSTOM_URL = "agentlogs.ai";

async function handleDocsProxy(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/docs")) {
    return null;
  }

  // Proxy to Mintlify
  const proxyUrl = new URL(request.url);
  proxyUrl.hostname = DOCS_URL;

  const proxyRequest = new Request(proxyUrl, request);
  proxyRequest.headers.set("Host", DOCS_URL);
  proxyRequest.headers.set("X-Forwarded-Host", CUSTOM_URL);
  proxyRequest.headers.set("X-Forwarded-Proto", "https");

  return fetch(proxyRequest);
}

export default createServerEntry({
  async fetch(request: Request) {
    // Proxy /docs to Mintlify
    const docsResponse = await handleDocsProxy(request);
    if (docsResponse) {
      return docsResponse;
    }

    return handler.fetch(request);
  },
});
