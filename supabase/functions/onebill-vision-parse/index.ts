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

const ONEBILL_API_KEY = "2|9TuPterPak3MpuF7EYWWicw5u3SZ46PXxnmp3tVN1994555e";

const PARSE_PROMPT = `You are OneBill AI for Irish utility documents.

Analyze this image and determine what type it is:
1. METER READING: A photo of an electricity or gas meter showing current readings
2. GAS BILL: A document/bill from a gas supplier with GPRN and usage details
3. ELECTRICITY BILL: A document/bill from electricity supplier with MPRN, MCC, and DG details

Extract relevant information based on type:

For METER READING:
- meter_type: "electricity" or "gas"
- reading_value: the current meter reading number
- meter_number: meter serial/ID if visible

For GAS BILL:
- gprn: Gas Point Registration Number (format: xxxxxxxx)
- supplier_name: Gas supplier company name
- account_number: Customer account number
- meter_readings: array of readings with dates and values

For ELECTRICITY BILL:
- mprn: Meter Point Registration Number (format: xxxxxxxxxx)
- mcc_type: Market Category Code (e.g., "Domestic", "Commercial")
- dg_type: Deemed Group type (e.g., "DG1", "DG2", "DG3")
- supplier_name: Electricity supplier company name
- account_number: Customer account number
- meter_readings: array of readings with dates and values

Be precise with meter identifiers (GPRN, MPRN) and extract them exactly as shown.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, file_path, phone } = await req.json();
    
    if (!phone) {
      return new Response(
        JSON.stringify({ error: "Phone number is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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
            name: "classify_and_extract",
            description: "Classify document type and extract relevant data",
            parameters: {
              type: "object",
              properties: {
                document_type: {
                  type: "string",
                  enum: ["meter_reading", "gas_bill", "electricity_bill"],
                  description: "Type of document detected"
                },
                meter_reading: {
                  type: "object",
                  properties: {
                    meter_type: { type: "string", enum: ["electricity", "gas"] },
                    reading_value: { type: "number" },
                    meter_number: { type: "string" }
                  }
                },
                gas_bill: {
                  type: "object",
                  properties: {
                    gprn: { type: "string" },
                    supplier_name: { type: "string" },
                    account_number: { type: "string" },
                    meter_readings: { type: "array", items: { type: "object" } }
                  }
                },
                electricity_bill: {
                  type: "object",
                  properties: {
                    mprn: { type: "string" },
                    mcc_type: { type: "string" },
                    dg_type: { type: "string" },
                    supplier_name: { type: "string" },
                    account_number: { type: "string" },
                    meter_readings: { type: "array", items: { type: "object" } }
                  }
                }
              },
              required: ["document_type"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "classify_and_extract" } }
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
    console.log("Parsed document:", parsedData.document_type);

    // Prepare form data for ONEBILL API
    const formData = new FormData();
    formData.append("phone", phone);
    
    // Get the file from storage
    const fileBlob = await fetch(fileUrl).then(r => r.blob());
    const fileName = fileUrl.split('/').pop() || 'document';
    formData.append("file", fileBlob, fileName);

    let apiEndpoint = "";
    let apiResponse;

    // Route based on document type
    switch (parsedData.document_type) {
      case "meter_reading":
        console.log("Routing to meter API");
        apiEndpoint = "https://api.onebill.ie/api/meter-file";
        apiResponse = await fetch(apiEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ONEBILL_API_KEY}`
          },
          body: formData
        });
        break;

      case "gas_bill":
        console.log("Routing to gas bill API");
        apiEndpoint = "https://api.onebill.ie/api/gas-file";
        if (parsedData.gas_bill?.gprn) {
          formData.append("gprn", parsedData.gas_bill.gprn);
        }
        apiResponse = await fetch(apiEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ONEBILL_API_KEY}`
          },
          body: formData
        });
        break;

      case "electricity_bill":
        console.log("Routing to electricity bill API");
        apiEndpoint = "https://api.onebill.ie/api/electricity-file";
        if (parsedData.electricity_bill?.mprn) {
          formData.append("mprn", parsedData.electricity_bill.mprn);
        }
        if (parsedData.electricity_bill?.mcc_type) {
          formData.append("mcc_type", parsedData.electricity_bill.mcc_type);
        }
        if (parsedData.electricity_bill?.dg_type) {
          formData.append("dg_type", parsedData.electricity_bill.dg_type);
        }
        apiResponse = await fetch(apiEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ONEBILL_API_KEY}`
          },
          body: formData
        });
        break;

      default:
        return new Response(
          JSON.stringify({ error: "Unknown document type" }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const apiResult = await apiResponse.text();
    console.log("ONEBILL API response:", apiResponse.status, apiResult.slice(0, 200));

    return new Response(
      JSON.stringify({
        ok: apiResponse.ok,
        data: parsedData,
        api_endpoint: apiEndpoint,
        api_status: apiResponse.status,
        api_response: apiResult
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
