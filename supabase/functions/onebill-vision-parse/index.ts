import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to get visual inputs for AI - tries direct URL first, falls back to conversion
async function getVisualInputs(fileUrl: string, isPdf: boolean): Promise<{ urls: string[], usedConversion: boolean }> {
  if (!isPdf) {
    return { urls: [fileUrl], usedConversion: false };
  }

  console.log("PDF detected, attempting direct URL first:", fileUrl);
  return { urls: [fileUrl], usedConversion: false };
}

// Fallback: convert PDF to images and upload to storage
async function convertPdfToStorageUrls(pdfUrl: string): Promise<string[]> {
  console.log("Converting PDF to images and uploading to storage:", pdfUrl);
  
  try {
    const convertResponse = await fetch('https://v2.convertapi.com/convert/pdf/to/png', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Parameters: [
          { Name: 'File', FileValue: { Url: pdfUrl } },
          { Name: 'ImageResolution', Value: '150' }
        ]
      })
    });

    if (!convertResponse.ok) {
      console.error("PDF conversion API failed:", convertResponse.status);
      return [];
    }

    const convertData = await convertResponse.json();
    const files = convertData.Files || [];
    
    if (files.length === 0) {
      console.error("No files returned from conversion");
      return [];
    }

    // Prefer direct URLs from the converter when available
    const directUrls = files
      .map((f: any) => f.FileUrl)
      .filter((u: string | undefined) => typeof u === 'string')
      .slice(0, 3);
    if (directUrls.length > 0) {
      console.log(`Using ${directUrls.length} direct converted page URL(s)`);
      return directUrls;
    }

    // Otherwise, upload decoded images to Storage and return public URLs
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const uploadedUrls: string[] = [];
    const timestamp = Date.now();
    
    for (let i = 0; i < Math.min(files.length, 3); i++) {
      const file = files[i];
      const fileName = `converted/${timestamp}-p${i + 1}.png`;
      const base64Data: string | undefined = file.FileData;
      if (!base64Data) continue;
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const { error } = await supabase.storage
        .from('bills')
        .upload(fileName, binaryData, { contentType: 'image/png', upsert: true });
      if (error) {
        console.error(`Failed to upload page ${i + 1}:`, error);
        continue;
      }
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/bills/${fileName}`;
      uploadedUrls.push(publicUrl);
    }
    
    console.log(`Converted and uploaded ${uploadedUrls.length} pages`);
    return uploadedUrls;
  } catch (error) {
    console.error("Error in PDF conversion:", error);
    return [];
  }
}

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
    
    const ONEBILL_API_KEY = Deno.env.get("ONEBILL_API_KEY");
    if (!ONEBILL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ONEBILL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Detect if it's a PDF
    const isPdf = fileUrl.toLowerCase().endsWith('.pdf');
    
    // Get visual inputs (URLs for AI)
    let { urls: imageUrls, usedConversion } = await getVisualInputs(fileUrl, isPdf);
    console.log(`Parsing with ${imageUrls.length} image(s), conversion: ${usedConversion}`);

    // Build content array with text and images/documents
    const content: any[] = [{ type: "text", text: PARSE_PROMPT }];
    
    // If it's a PDF and we didn't convert yet, send as a document instead of image
    if (isPdf && !usedConversion) {
      content.push({ type: "document", document_url: { url: imageUrls[0] } });
    } else {
      for (const imgUrl of imageUrls.slice(0, 3)) {
        content.push({ type: "image_url", image_url: { url: imgUrl } });
      }
    }

    // Call Lovable AI with vision model
    let aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content }],
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

    // If AI fails with 400 (image extraction error) and it's a PDF, try conversion fallback
    if (!aiResponse.ok && aiResponse.status === 400 && isPdf && !usedConversion) {
      const errorText = await aiResponse.text();
      console.log("Direct PDF failed, attempting conversion fallback:", errorText.slice(0, 200));
      
      const convertedUrls = await convertPdfToStorageUrls(fileUrl);
      if (convertedUrls.length === 0) {
        return new Response(
          JSON.stringify({
            error: "Failed to process PDF",
            details: "Both direct parsing and conversion failed. Please try uploading a JPG or PNG image."
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Retry with converted images
      imageUrls = convertedUrls;
      usedConversion = true;
      console.log(`Retrying with ${imageUrls.length} converted images`);
      
      const retryContent: any[] = [{ type: "text", text: PARSE_PROMPT }];
      for (const imgUrl of imageUrls.slice(0, 3)) {
        retryContent.push({ type: "image_url", image_url: { url: imgUrl } });
      }
      
      aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user", content: retryContent }],
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
    }

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
    
    // Get the original file from storage (use first converted URL if we converted)
    const fileToSend = usedConversion ? imageUrls[0] : fileUrl;
    const fileBlob = await fetch(fileToSend).then(r => r.blob());
    const fileName = fileToSend.split('/').pop() || 'document';
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
