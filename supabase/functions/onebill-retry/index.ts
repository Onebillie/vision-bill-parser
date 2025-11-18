import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

type RetryBody = {
  type: "meter" | "electricity" | "gas";
  endpoint: string;
  payload?: any; // JSON payload for electricity/gas
  phone?: string; // used for meter
  file_path?: string | null; // path in storage/bills for meter
  file_url?: string | null; // optional direct URL to the file (if available)
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ONEBILL_API_KEY = Deno.env.get("ONEBILL_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    if (!ONEBILL_API_KEY) throw new Error("ONEBILL_API_KEY not configured");

    const body = (await req.json()) as RetryBody;
    const { type, endpoint, payload, phone, file_path, file_url } = body;

    if (!endpoint || !type) {
      return new Response(JSON.stringify({ error: "Missing endpoint or type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const MAX_RETRIES = 3;
    const BASE_DELAY = 500; // ms

    let lastStatus = 0;
    let lastText = "";

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        let resp: Response;

        if (type === "meter") {
          if (!phone) {
            throw new Error("Phone is required for meter retry");
          }
          const form = new FormData();

          // Resolve a URL to fetch the original file
          let urlToFetch: string | undefined = undefined;
          if (file_url) {
            urlToFetch = file_url;
          } else if (file_path && SUPABASE_URL) {
            urlToFetch = `${SUPABASE_URL}/storage/v1/object/public/bills/${encodeURIComponent(file_path)}`;
          }

          if (urlToFetch) {
            try {
              const f = await fetch(urlToFetch);
              const buf = await f.arrayBuffer();
              
              // Detect content type with support for Excel files
              let contentType = f.headers.get("content-type");
              if (!contentType) {
                const urlLower = urlToFetch.toLowerCase();
                if (urlLower.endsWith(".xlsx")) {
                  contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                } else if (urlLower.endsWith(".xls")) {
                  contentType = "application/vnd.ms-excel";
                } else if (urlLower.endsWith(".csv")) {
                  contentType = "text/csv";
                } else if (urlLower.endsWith(".png")) {
                  contentType = "image/png";
                } else if (urlLower.endsWith(".jpg") || urlLower.endsWith(".jpeg")) {
                  contentType = "image/jpeg";
                } else if (urlLower.endsWith(".pdf")) {
                  contentType = "application/pdf";
                } else {
                  contentType = "application/octet-stream";
                }
              }
              
              const name = typeof file_path === "string" && file_path.length > 0 ? file_path : "upload.bin";
              
              // Use Uint8Array for non-Excel files (working approach), direct ArrayBuffer for Excel
              const urlLower = urlToFetch.toLowerCase();
              const isExcelFile = urlLower.endsWith(".xlsx") || urlLower.endsWith(".xls");
              const blob = isExcelFile 
                ? new Blob([buf], { type: contentType })
                : new Blob([new Uint8Array(buf)], { type: contentType });
              form.append("file", blob, name);
            } catch (e) {
              console.error("meter-retry: failed to fetch original file:", e);
            }
          }

          form.append("phone", phone);

          resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ONEBILL_API_KEY}`,
            },
            body: form,
          });
        } else {
          // electricity / gas - also use multipart/form-data
          const form = new FormData();

          // Resolve a URL to fetch the original file
          let urlToFetch: string | undefined = undefined;
          if (file_url) {
            urlToFetch = file_url;
          } else if (file_path && SUPABASE_URL) {
            urlToFetch = `${SUPABASE_URL}/storage/v1/object/public/bills/${encodeURIComponent(file_path)}`;
          }

          if (urlToFetch) {
            try {
              const f = await fetch(urlToFetch);
              const buf = await f.arrayBuffer();
              
              // Detect content type with support for Excel files
              let contentType = f.headers.get("content-type");
              if (!contentType) {
                const urlLower = urlToFetch.toLowerCase();
                if (urlLower.endsWith(".xlsx")) {
                  contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                } else if (urlLower.endsWith(".xls")) {
                  contentType = "application/vnd.ms-excel";
                } else if (urlLower.endsWith(".csv")) {
                  contentType = "text/csv";
                } else if (urlLower.endsWith(".png")) {
                  contentType = "image/png";
                } else if (urlLower.endsWith(".jpg") || urlLower.endsWith(".jpeg")) {
                  contentType = "image/jpeg";
                } else if (urlLower.endsWith(".pdf")) {
                  contentType = "application/pdf";
                } else {
                  contentType = "application/octet-stream";
                }
              }
              
              const name = typeof file_path === "string" && file_path.length > 0 ? file_path : "upload.bin";
              
              // Use Uint8Array for non-Excel files (working approach), direct ArrayBuffer for Excel
              const urlLower = urlToFetch.toLowerCase();
              const isExcelFile = urlLower.endsWith(".xlsx") || urlLower.endsWith(".xls");
              const blob = isExcelFile 
                ? new Blob([buf], { type: contentType })
                : new Blob([new Uint8Array(buf)], { type: contentType });
              form.append("file", blob, name);
            } catch (e) {
              console.error(`${type}-retry: failed to fetch original file:`, e);
            }
          }

          // Append text fields from payload
          for (const [key, value] of Object.entries(payload ?? {})) {
            form.append(key, String(value));
          }

          console.log(`${type}-retry fields (non-binary):`, JSON.stringify(payload ?? {}, null, 2));

          resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ONEBILL_API_KEY}`,
            },
            body: form,
          });
        }

        lastStatus = resp.status;
        lastText = await resp.text();

        if (resp.ok) {
          return new Response(
            JSON.stringify({ ok: true, status: lastStatus, response: lastText.slice(0, 4096) }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // retry on 5xx and 429
        if (attempt < MAX_RETRIES - 1 && (resp.status >= 500 || resp.status === 429)) {
          const delay = BASE_DELAY * Math.pow(2, attempt); // 500, 1000, 2000
          await sleep(delay);
          continue;
        }

        // non-retryable or last attempt
        break;
      } catch (err) {
        lastStatus = 500;
        lastText = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: false, status: lastStatus, error: lastText.slice(0, 4096) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("onebill-retry error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
