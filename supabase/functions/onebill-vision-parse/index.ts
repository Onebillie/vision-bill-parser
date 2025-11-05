import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to convert PDF to images using pdf-lib
async function pdfToImages(pdfUrl: string): Promise<string[]> {
  console.log("Converting PDF to images:", pdfUrl);
  
  // Fetch PDF
  const pdfResponse = await fetch(pdfUrl);
  const pdfBlob = await pdfResponse.blob();
  const pdfBuffer = await pdfBlob.arrayBuffer();
  
  // For PDFs, we'll use an external conversion service or return the PDF URL
  // Since Deno edge functions have limited PDF processing, we return the PDF URL
  // and let the AI model handle it directly (Gemini supports PDF)
  return [pdfUrl];
}

const PARSE_PROMPT = `You are OneBill AI.

Parse this Irish utility bill image. Detect which utilities are present (electricity, gas, broadband) and extract all relevant information.

Rules:
- Dates: "YYYY-MM-DD"; unknown → "0000-00-00"
- Numbers: numeric; unknown → 0
- Booleans: true/false
- Detect utilities using signals: MPRN/MCC/DG → electricity; GPRN/carbon tax → gas
- Return complete data for all detected utilities`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, file_path } = await req.json();
    
    let fileUrl = image_url;
    
    // If file_path is provided, construct the Supabase Storage URL
    if (file_path) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      fileUrl = `${supabaseUrl}/storage/v1/object/public/bills/${file_path}`;
      console.log("Using uploaded file:", fileUrl);
    }
    
    if (!fileUrl) {
      return new Response(
        JSON.stringify({ error: "Either image_url or file_path is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Detect if it's a PDF and convert to images if needed
    const isPdf = fileUrl.toLowerCase().endsWith('.pdf');
    const imageUrls = isPdf ? await pdfToImages(fileUrl) : [fileUrl];

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    console.log("Parsing bill with Lovable AI. Images:", imageUrls.length);

    // Build content array with text and images
    const content: any[] = [{ type: "text", text: PARSE_PROMPT }];
    
    // Add all images (max 3 for multi-page bills)
    for (const imgUrl of imageUrls.slice(0, 3)) {
      content.push({ type: "image_url", image_url: { url: imgUrl } });
    }

    // Call Lovable AI with vision model
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro", // Best for vision + complex reasoning + document parsing
        messages: [
          {
            role: "user",
            content
          }
        ],
        tools: [{
          type: "function",
          function: {
            name: "parse_bill",
            description: "Extract structured bill data",
            parameters: {
              type: "object",
              properties: {
                bills: {
                  type: "object",
                  properties: {
                    cus_details: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          details: {
                            type: "object",
                            properties: {
                              customer_name: { type: "string" },
                              address: {
                                type: "object",
                                properties: {
                                  line_1: { type: "string" },
                                  line_2: { type: "string" },
                                  city: { type: "string" },
                                  county: { type: "string" },
                                  eircode: { type: "string" }
                                }
                              }
                            }
                          },
                          services: {
                            type: "object",
                            properties: {
                              gas: { type: "boolean" },
                              broadband: { type: "boolean" },
                              electricity: { type: "boolean" }
                            }
                          }
                        }
                      }
                    },
                    electricity: { type: "array", items: { type: "object" } },
                    gas: { type: "array", items: { type: "object" } },
                    broadband: { type: "array", items: { type: "object" } }
                  },
                  required: ["cus_details", "electricity", "gas", "broadband"]
                }
              },
              required: ["bills"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "parse_bill" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText.slice(0, 500));
      return new Response(
        JSON.stringify({
          error: "AI parsing failed",
          status: aiResponse.status,
          details: errorText.slice(0, 500)
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    console.log("AI response received");

    // Extract parsed data from tool call
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ error: "No structured data returned from AI" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parsedData = JSON.parse(toolCall.function.arguments);
    console.log("Parsed bill data successfully");

    // Route to ONEBILL API based on detected services
    const services = parsedData.bills?.cus_details?.[0]?.services || {};
    const routed = [];

    if (services.electricity) {
      console.log("Routing to electricity API");
      const elecResponse = await fetch("https://api.onebill.ie/api/electricity-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedData)
      });
      routed.push({ endpoint: "electricity-file", status: elecResponse.status });
    }

    if (services.gas) {
      console.log("Routing to gas API");
      const gasResponse = await fetch("https://api.onebill.ie/api/gas-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedData)
      });
      routed.push({ endpoint: "gas-file", status: gasResponse.status });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        data: parsedData,
        routed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in onebill-vision-parse:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
