const { app, BrowserWindow, net, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { buildApp } = require("./server-bundle.cjs");

const SERVICE_ORIGIN = process.env.WX_LAYOUT_SERVICE_ORIGIN
  || "https://wx-layout-studio.pengkunwang886.chatgpt.site";
const RENDERER_ROOT = path.join(__dirname, "renderer");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function proxyApi(request, response, serviceOrigin) {
  try {
    const target = new URL(request.url, serviceOrigin);
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await readRequestBody(request);
    const upstream = await net.fetch(target, {
      method: request.method,
      headers: {
        accept: request.headers.accept || "application/json",
        "content-type": request.headers["content-type"] || "application/json"
      },
      body,
      redirect: "manual"
    });
    response.writeHead(upstream.status, {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") || "application/octet-stream"
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      error: {
        code: "desktop_service_unavailable",
        message: "暂时无法连接线上服务，请检查网络后重试。"
      }
    }));
  }
}

function serveStatic(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(RENDERER_ROOT, relativePath);
  const rendererPrefix = `${path.resolve(RENDERER_ROOT)}${path.sep}`;
  if (filePath !== path.join(RENDERER_ROOT, "index.html") && !filePath.startsWith(rendererPrefix)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(RENDERER_ROOT, "index.html");
  }

  response.writeHead(200, {
    "cache-control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "x-content-type-options": "nosniff"
  });
  fs.createReadStream(filePath).pipe(response);
}

async function createLocalServer(serviceOrigin) {
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/")) {
      void proxyApi(request, response, serviceOrigin);
      return;
    }
    serveStatic(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

async function createLocalApi() {
  process.env.WX_LAYOUT_DATA_DIR = path.join(app.getPath("userData"), "data");
  const api = buildApp({ logger: false });
  await api.listen({ host: "127.0.0.1", port: 0 });
  const address = api.server.address();
  if (!address || typeof address === "string") throw new Error("Desktop API did not start");
  return { api, origin: `http://127.0.0.1:${address.port}` };
}

async function createWindow(server) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop server did not start");
  const localOrigin = `http://127.0.0.1:${address.port}`;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#f4f1e8",
    title: "WX Layout",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(localOrigin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  await window.loadURL(localOrigin);
}

let localServer;
let localApi;

app.whenReady().then(async () => {
  let serviceOrigin = SERVICE_ORIGIN;
  if (!serviceOrigin) {
    const local = await createLocalApi();
    localApi = local.api;
    serviceOrigin = local.origin;
  }
  localServer = await createLocalServer(serviceOrigin);
  await createWindow(localServer);
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow(localServer);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  localServer?.close();
  void localApi?.close();
});
