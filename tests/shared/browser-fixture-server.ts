export interface BrowserFixtureServer {
  server: Deno.HttpServer<Deno.NetAddr>;
  port: number;
  baseUrl: string;
}

const HYBRID_OVERLAY_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Hybrid Escalation Fixture</title></head>
<body style="margin:0;font-family:sans-serif;">
  <div id="overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
    <div style="background:white;padding:40px;border-radius:8px;text-align:center;min-width:300px;">
      <p style="font-size:18px;margin-bottom:20px;">Click the button below to continue</p>
      <canvas id="accept-canvas" width="200" height="50" style="cursor:pointer;"></canvas>
    </div>
  </div>
  <div style="text-align:center;margin-top:100px;">
    <h1>Hybrid Escalation Test</h1>
    <button id="submit-btn" onclick="document.getElementById('result').textContent='Success'"
      style="padding:16px 48px;font-size:20px;cursor:pointer;">Submit</button>
    <p><span id="result" style="font-size:24px;font-weight:bold;color:#4CAF50;"></span></p>
  </div>
  <script>
    const canvas = document.getElementById('accept-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4CAF50';
    ctx.beginPath();
    ctx.roundRect(0, 0, 200, 50, 8);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Accept', 100, 25);
    canvas.addEventListener('click', () => {
      document.getElementById('overlay').style.display = 'none';
    });
  </script>
</body>
</html>`;

const FORM_FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Form Fixture</title></head>
<body style="margin:40px;font-family:sans-serif;">
  <h1>Registration Form</h1>
  <form id="reg-form" onsubmit="event.preventDefault();
    document.getElementById('form-area').style.display='none';
    document.getElementById('result-area').style.display='block';
    document.getElementById('result-name').textContent=document.getElementById('name-input').value;
    document.getElementById('result-email').textContent=document.getElementById('email-input').value;">
    <div id="form-area">
      <label>Name: <input id="name-input" type="text" placeholder="Your name" style="padding:8px;font-size:16px;"></label><br><br>
      <label>Email: <input id="email-input" type="email" placeholder="you@example.com" style="padding:8px;font-size:16px;"></label><br><br>
      <button type="submit" style="padding:12px 32px;font-size:16px;cursor:pointer;">Register</button>
    </div>
  </form>
  <div id="result-area" style="display:none;">
    <h2>Registration Complete</h2>
    <p>Name: <span id="result-name"></span></p>
    <p>Email: <span id="result-email"></span></p>
  </div>
</body>
</html>`;

const DELAYED_FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Delayed Content</title></head>
<body style="margin:40px;font-family:sans-serif;">
  <h1>Loading...</h1>
  <div id="content" style="display:none;">
    <p id="secret">The answer is 42.</p>
  </div>
  <script>
    setTimeout(() => {
      document.querySelector('h1').textContent = 'Ready';
      document.getElementById('content').style.display = 'block';
    }, 2000);
  </script>
</body>
</html>`;

const TABS_START_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Tabs Fixture Start</title></head>
<body style="font-family:sans-serif;margin:40px;">
  <h1>Tabs Start</h1>
  <a id="next-link" href="/tabs/next">Go to next page</a>
</body>
</html>`;

const TABS_NEXT_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Tabs Fixture Next</title></head>
<body style="font-family:sans-serif;margin:40px;">
  <h1>Tabs Next</h1>
  <p id="tabs-next-copy">You reached the second page.</p>
</body>
</html>`;

const TABS_OTHER_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Tabs Fixture Other</title></head>
<body style="font-family:sans-serif;margin:40px;">
  <h1>Tabs Other</h1>
</body>
</html>`;

const SELECT_FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Select Fixture</title></head>
<body style="font-family:sans-serif;margin:40px;">
  <h1>Favorite pet</h1>
  <label for="pet-select">Favorite pet</label>
  <select id="pet-select" aria-label="Favorite pet" onchange="document.getElementById('selected-value').textContent=this.value;">
    <option value="">Choose a pet</option>
    <option value="cat">Cat</option>
    <option value="dog">Dog</option>
    <option value="hamster">Hamster</option>
  </select>
  <p id="selected-value">Choose a pet</p>
</body>
</html>`;

const UPLOAD_FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Upload Fixture</title></head>
<body style="font-family:sans-serif;margin:40px;">
  <h1>Upload documents</h1>
  <label for="upload-input">Upload documents</label>
  <input id="upload-input" aria-label="Upload documents" type="file" multiple
    onchange="document.getElementById('uploaded-names').textContent = Array.from(this.files).map(file => file.name).join(', ');" />
  <p id="uploaded-names">No files selected</p>
</body>
</html>`;

const FIXTURE_ROUTES: Record<string, string> = {
  "/": HYBRID_OVERLAY_HTML,
  "/form": FORM_FIXTURE_HTML,
  "/delayed": DELAYED_FIXTURE_HTML,
  "/tabs/start": TABS_START_HTML,
  "/tabs/next": TABS_NEXT_HTML,
  "/tabs/other": TABS_OTHER_HTML,
  "/select": SELECT_FIXTURE_HTML,
  "/upload": UPLOAD_FIXTURE_HTML,
};

export function startBrowserFixtureServer(): BrowserFixtureServer {
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    (req) => {
      const url = new URL(req.url);
      const html = FIXTURE_ROUTES[url.pathname] ?? FIXTURE_ROUTES["/"]!;
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  );
  const port = server.addr.port;
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}
