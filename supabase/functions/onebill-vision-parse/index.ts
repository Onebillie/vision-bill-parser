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

const PARSE_PROMPT = `Parse a single Irish customer bill from the page images provided. Bills may bundle utilities (electricity and gas). Detect which utilities are present and disaggregate them. Return ONE JSON object only. No prose or notes.

Rules:
- Dates: "YYYY-MM-DD"; unknown → "0000-00-00".
- Numbers (rates/amounts/readings): numeric; unknown → 0.
- Booleans: true/false (not strings).
- Currencies: "cent" or "euro".
- Standing charge period: "daily" or "annual".
- Always include all top-level sections; if a utility is not present, return its array as [].
- Detect utilities using strong signals (MPRN/MCC/DG ⇒ electricity; GPRN/carbon tax ⇒ gas; MPRN or GPRN present ⇒ meter; broadband cues for broadband).
- Do not rename, add, or remove keys.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
      const encodedPath = file_path.split('/').map(encodeURIComponent).join('/');
      fileUrl = `${supabaseUrl}/storage/v1/object/public/bills/${encodedPath}`;
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

    if (isPdf && !usedConversion) {
      // Send PDF as a document URL (ensure URL is safe for fetching)
      const pdfUrl = imageUrls[0]?.replace(/ /g, "%20");
      if (pdfUrl) {
        content.push({ type: "document", document_url: { url: pdfUrl } });
      }
    } else {
      // Download images and convert to base64 data URLs for reliable ingestion
      for (const rawUrl of imageUrls.slice(0, 3)) {
        const imgUrl = rawUrl.replace(/ /g, "%20"); // handle spaces in filenames
        try {
          console.log("Fetching image:", imgUrl);
          const imageResponse = await fetch(imgUrl);
          if (!imageResponse.ok) {
            console.error(`Failed to fetch image: ${imageResponse.status}`);
            continue;
          }

          const imageBuffer = await imageResponse.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
          const mimeType = imageResponse.headers.get('content-type') || 'image/png';
          const dataUrl = `data:${mimeType};base64,${base64}`;

          content.push({ type: "image_url", image_url: { url: dataUrl } });
          console.log(`Added image as base64 data URL (${(base64.length / 1024).toFixed(1)}KB)`);
        } catch (error) {
          console.error("Error converting image to base64:", error);
        }
      }
    }

    // Fallback for PDFs: try converting to page images if nothing could be loaded
    if (content.length === 1 && isPdf) {
      const convertedUrls = await convertPdfToStorageUrls(fileUrl);
      for (const rawUrl of convertedUrls.slice(0, 3)) {
        const imgUrl = rawUrl.replace(/ /g, "%20");
        try {
          const imageResponse = await fetch(imgUrl);
          if (!imageResponse.ok) continue;
          const imageBuffer = await imageResponse.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
          const dataUrl = `data:image/png;base64,${base64}`;
          content.push({ type: "image_url", image_url: { url: dataUrl } });
        } catch (_e) {}
      }
    }

    if (content.length === 1) {
      throw new Error("No images could be loaded for parsing");
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
        temperature: 0,
        tools: [{
          type: "function",
          function: {
            name: "parse_irish_bill",
            description: "Parse Irish utility bill and return structured data",
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
                              electricity: { type: "boolean" },
                              meter: { type: "boolean" }
                            }
                          }
                        }
                      }
                    },
                    electricity: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          electricity_details: {
                            type: "object",
                            properties: {
                              invoice_number: { type: "string" },
                              account_number: { type: "string" },
                              contract_end_date: { type: "string" },
                              meter_details: {
                                type: "object",
                                properties: {
                                  mprn: { type: "string" },
                                  dg: { type: "string" },
                                  mcc: { type: "string" },
                                  profile: { type: "string" }
                                }
                              }
                            }
                          },
                          supplier_details: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              tariff_name: { type: "string" },
                              issue_date: { type: "string" },
                              billing_period: { type: "string" }
                            }
                          },
                          charges_and_usage: {
                            type: "object",
                            properties: {
                              meter_readings: {
                                type: "array",
                                items: {
                                  type: "object",
                                  properties: {
                                    reading_type: { type: "string" },
                                    date: { type: "string" },
                                    nsh_reading: { type: "number" },
                                    day_reading: { type: "number" },
                                    night_reading: { type: "number" },
                                    peak_reading: { type: "number" }
                                  }
                                }
                              },
                              detailed_kWh_usage: {
                                type: "array",
                                items: {
                                  type: "object",
                                  properties: {
                                    start_read_date: { type: "string" },
                                    end_read_date: { type: "string" },
                                    day_kWh: { type: "number" },
                                    night_kWh: { type: "number" },
                                    peak_kWh: { type: "number" },
                                    ev_kWh: { type: "number" }
                                  }
                                }
                              },
                              unit_rates: {
                                type: "object",
                                properties: {
                                  "24_hour_rate": { type: "number" },
                                  day: { type: "number" },
                                  night: { type: "number" },
                                  peak: { type: "number" },
                                  ev: { type: "number" },
                                  nsh: { type: "number" },
                                  rate_currency: { type: "string", enum: ["cent", "euro"] },
                                  rate_discount_percentage: { type: "number" }
                                }
                              },
                              standing_charge: { type: "number" },
                              standing_charge_currency: { type: "string", enum: ["cent", "euro"] },
                              standing_charge_period: { type: "string", enum: ["daily", "annual"] },
                              nsh_standing_charge: { type: "number" },
                              nsh_standing_charge_currency: { type: "string", enum: ["cent", "euro"] },
                              nsh_standing_charge_period: { type: "string", enum: ["daily", "annual"] },
                              pso_levy: { type: "number" }
                            }
                          },
                          financial_information: {
                            type: "object",
                            properties: {
                              total_due: { type: "number" },
                              amount_due: { type: "number" },
                              due_date: { type: "string" },
                              payment_due_date: { type: "string" }
                            }
                          }
                        },
                        additionalProperties: false
                      }
                    },
                    gas: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          gas_details: {
                            type: "object",
                            properties: {
                              invoice_number: { type: "string" },
                              account_number: { type: "string" },
                              contract_end_date: { type: "string" },
                              meter_details: {
                                type: "object",
                                properties: {
                                  gprn: { type: "string" }
                                }
                              }
                            }
                          },
                          supplier_details: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              tariff_name: { type: "string" },
                              issue_date: { type: "string" },
                              billing_period: { type: "string" }
                            }
                          },
                          charges_and_usage: {
                            type: "object",
                            properties: {
                              meter_readings: {
                                type: "array",
                                items: {
                                  type: "object",
                                  properties: {
                                    meter_type: { type: "string" },
                                    date: { type: "string" },
                                    reading: { type: "number" }
                                  }
                                }
                              },
                              unit_rates: {
                                type: "object",
                                properties: {
                                  rate: { type: "number" },
                                  rate_currency: { type: "string", enum: ["cent", "euro"] }
                                }
                              },
                              standing_charge: { type: "number" },
                              standing_charge_currency: { type: "string", enum: ["cent", "euro"] },
                              standing_charge_period: { type: "string", enum: ["daily", "annual"] },
                              carbon_tax: { type: "number" }
                            }
                          },
                          financial_information: {
                            type: "object",
                            properties: {
                              total_due: { type: "number" },
                              amount_due: { type: "number" },
                              due_date: { type: "string" },
                              payment_due_date: { type: "string" }
                            }
                          }
                        },
                        additionalProperties: false
                      }
                    },
                    broadband: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          broadband_details: {
                            type: "object",
                            properties: {
                              account_number: { type: "string" },
                              phone_numbers: {
                                type: "array",
                                items: { type: "string" }
                              }
                            }
                          },
                          supplier_details: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              tariff_name: { type: "string" },
                              issue_date: { type: "string" },
                              billing_period: { type: "string" }
                            }
                          },
                          service_details: {
                            type: "object",
                            properties: {
                              broadband_number: { type: "string" },
                              uan_number: { type: "string" },
                              connection_type: { type: "string" },
                              home_phone_number: { type: "string" },
                              mobile_phone_numbers: {
                                type: "array",
                                items: { type: "string" }
                              },
                              utility_types: {
                                type: "array",
                                items: { type: "string" }
                              }
                            }
                          },
                          package_information: {
                            type: "object",
                            properties: {
                              package_name: { type: "string" },
                              contract_changes: { type: "string" },
                              contract_end_date: { type: "string" },
                              what_s_included: {
                                type: "object",
                                properties: {
                                  calls: { type: "string" },
                                  usage: { type: "string" },
                                  bandwidth: { type: "string" },
                                  usage_minutes: { type: "string" },
                                  int_call_packages: { type: "string" },
                                  local_national_calls: { type: "string" }
                                }
                              }
                            }
                          },
                          financial_information: {
                            type: "object",
                            properties: {
                              previous_bill_amount: { type: "number" },
                              total_due: { type: "number" },
                              amount_due: { type: "number" },
                              due_date: { type: "string" },
                              payment_due_date: { type: "string" },
                              payment_method: { type: "string" },
                              payments_received: { type: "string" },
                              bank_details: {
                                type: "object",
                                properties: {
                                  iban: { type: "string" },
                                  bic: { type: "string" }
                                }
                              }
                            }
                          }
                        },
                        additionalProperties: false
                      }
                    }
                  },
                  required: ["cus_details", "electricity", "gas", "broadband"],
                  additionalProperties: true
                }
              },
              required: ["bills"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "parse_irish_bill" } }
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
          temperature: 0,
          tools: [{
            type: "function",
            function: {
              name: "parse_irish_bill",
              description: "Parse Irish utility bill and return structured data",
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
                      electricity: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            electricity_details: {
                              type: "object",
                              properties: {
                                invoice_number: { type: "string" },
                                account_number: { type: "string" },
                                contract_end_date: { type: "string" },
                                meter_details: {
                                  type: "object",
                                  properties: {
                                    mprn: { type: "string" },
                                    dg: { type: "string" },
                                    mcc: { type: "string" },
                                    profile: { type: "string" }
                                  }
                                }
                              }
                            },
                            supplier_details: {
                              type: "object",
                              properties: {
                                name: { type: "string" },
                                tariff_name: { type: "string" },
                                issue_date: { type: "string" },
                                billing_period: { type: "string" }
                              }
                            },
                            charges_and_usage: {
                              type: "object",
                              properties: {
                                meter_readings: {
                                  type: "array",
                                  items: {
                                    type: "object",
                                    properties: {
                                      reading_type: { type: "string" },
                                      date: { type: "string" },
                                      nsh_reading: { type: "number" },
                                      day_reading: { type: "number" },
                                      night_reading: { type: "number" },
                                      peak_reading: { type: "number" }
                                    }
                                  }
                                },
                                detailed_kWh_usage: {
                                  type: "array",
                                  items: {
                                    type: "object",
                                    properties: {
                                      start_read_date: { type: "string" },
                                      end_read_date: { type: "string" },
                                      day_kWh: { type: "number" },
                                      night_kWh: { type: "number" },
                                      peak_kWh: { type: "number" },
                                      ev_kWh: { type: "number" }
                                    }
                                  }
                                },
                                unit_rates: {
                                  type: "object",
                                  properties: {
                                    "24_hour_rate": { type: "number" },
                                    day: { type: "number" },
                                    night: { type: "number" },
                                    peak: { type: "number" },
                                    ev: { type: "number" },
                                    nsh: { type: "number" },
                                    rate_currency: { type: "string", enum: ["cent", "euro"] },
                                    rate_discount_percentage: { type: "number" }
                                  }
                                },
                                standing_charge: { type: "number" },
                                standing_charge_currency: { type: "string", enum: ["cent", "euro"] },
                                standing_charge_period: { type: "string", enum: ["daily", "annual"] },
                                nsh_standing_charge: { type: "number" },
                                nsh_standing_charge_currency: { type: "string", enum: ["cent", "euro"] },
                                nsh_standing_charge_period: { type: "string", enum: ["daily", "annual"] },
                                pso_levy: { type: "number" }
                              }
                            },
                            financial_information: {
                              type: "object",
                              properties: {
                                total_due: { type: "number" },
                                amount_due: { type: "number" },
                                due_date: { type: "string" },
                                payment_due_date: { type: "string" }
                              }
                            }
                          },
                          additionalProperties: false
                        }
                      },
                      gas: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            gas_details: {
                              type: "object",
                              properties: {
                                invoice_number: { type: "string" },
                                account_number: { type: "string" },
                                contract_end_date: { type: "string" },
                                meter_details: {
                                  type: "object",
                                  properties: {
                                    gprn: { type: "string" }
                                  }
                                }
                              }
                            },
                            supplier_details: {
                              type: "object",
                              properties: {
                                name: { type: "string" },
                                tariff_name: { type: "string" },
                                issue_date: { type: "string" },
                                billing_period: { type: "string" }
                              }
                            },
                            charges_and_usage: {
                              type: "object",
                              properties: {
                                meter_readings: {
                                  type: "array",
                                  items: {
                                    type: "object",
                                    properties: {
                                      meter_type: { type: "string" },
                                      date: { type: "string" },
                                      reading: { type: "number" }
                                    }
                                  }
                                },
                                unit_rates: {
                                  type: "object",
                                  properties: {
                                    rate: { type: "number" },
                                    rate_currency: { type: "string", enum: ["cent", "euro"] }
                                  }
                                },
                                standing_charge: { type: "number" },
                                standing_charge_currency: { type: "string", enum: ["cent", "euro"] },
                                standing_charge_period: { type: "string", enum: ["daily", "annual"] },
                                carbon_tax: { type: "number" }
                              }
                            },
                            financial_information: {
                              type: "object",
                              properties: {
                                total_due: { type: "number" },
                                amount_due: { type: "number" },
                                due_date: { type: "string" },
                                payment_due_date: { type: "string" }
                              }
                            }
                          },
                          additionalProperties: false
                        }
                      },
                      broadband: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            broadband_details: {
                              type: "object",
                              properties: {
                                account_number: { type: "string" },
                                phone_numbers: {
                                  type: "array",
                                  items: { type: "string" }
                                }
                              }
                            },
                            supplier_details: {
                              type: "object",
                              properties: {
                                name: { type: "string" },
                                tariff_name: { type: "string" },
                                issue_date: { type: "string" },
                                billing_period: { type: "string" }
                              }
                            },
                            service_details: {
                              type: "object",
                              properties: {
                                broadband_number: { type: "string" },
                                uan_number: { type: "string" },
                                connection_type: { type: "string" },
                                home_phone_number: { type: "string" },
                                mobile_phone_numbers: {
                                  type: "array",
                                  items: { type: "string" }
                                },
                                utility_types: {
                                  type: "array",
                                  items: { type: "string" }
                                }
                              }
                            },
                            package_information: {
                              type: "object",
                              properties: {
                                package_name: { type: "string" },
                                contract_changes: { type: "string" },
                                contract_end_date: { type: "string" },
                                what_s_included: {
                                  type: "object",
                                  properties: {
                                    calls: { type: "string" },
                                    usage: { type: "string" },
                                    bandwidth: { type: "string" },
                                    usage_minutes: { type: "string" },
                                    int_call_packages: { type: "string" },
                                    local_national_calls: { type: "string" }
                                  }
                                }
                              }
                            },
                            financial_information: {
                              type: "object",
                              properties: {
                                previous_bill_amount: { type: "number" },
                                total_due: { type: "number" },
                                amount_due: { type: "number" },
                                due_date: { type: "string" },
                                payment_due_date: { type: "string" },
                                payment_method: { type: "string" },
                                payments_received: { type: "string" },
                                bank_details: {
                                  type: "object",
                                  properties: {
                                    iban: { type: "string" },
                                    bic: { type: "string" }
                                  }
                                }
                              }
                            }
                          },
                          additionalProperties: false
                        }
                      }
                    },
                    required: ["cus_details", "electricity", "gas", "broadband"],
                    additionalProperties: true
                  }
                },
                required: ["bills"],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: "function", function: { name: "parse_irish_bill" } }
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
    console.log("Parsed bill data received");

    // Validate and ensure all required sections exist
    if (!parsedData.bills) {
      parsedData.bills = {};
    }
    if (!parsedData.bills.cus_details) {
      parsedData.bills.cus_details = [];
    }
    if (!parsedData.bills.electricity) {
      parsedData.bills.electricity = [];
    }
    if (!parsedData.bills.gas) {
      parsedData.bills.gas = [];
    }
    if (!parsedData.bills.broadband) {
      parsedData.bills.broadband = [];
    }

    // Check service flags
    const services = parsedData.bills.cus_details?.[0]?.services;
    const hasElectricity = services?.electricity === true;
    const hasGas = services?.gas === true;
    const hasMeter = services?.meter === true;
    
    console.log("Services detected:", { electricity: hasElectricity, gas: hasGas, meter: hasMeter });

    if (!hasElectricity && !hasGas && !hasMeter) {
      return new Response(
        JSON.stringify({
          error: "No electricity, gas, or meter services detected in bill",
          parsed_data: parsedData,
          input_type: isPdf ? "pdf" : "image",
          used_conversion: usedConversion
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch active API configs from database
    const { data: apiConfigs, error: configError } = await supabase
      .from('api_configs')
      .select('endpoint_url, service_type')
      .eq('is_active', true);

    if (configError) {
      console.error("Error fetching API configs:", configError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch API configurations" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare API calls based on detected services and database configs
    const apiCalls: Array<{ endpoint: string; type: string }> = [];
    
    if (hasElectricity) {
      const config = apiConfigs?.find((c: any) => c.service_type === 'electricity');
      if (config) {
        apiCalls.push({
          endpoint: config.endpoint_url,
          type: "electricity"
        });
      }
    }
    
    if (hasGas) {
      const config = apiConfigs?.find((c: any) => c.service_type === 'gas');
      if (config) {
        apiCalls.push({
          endpoint: config.endpoint_url,
          type: "gas"
        });
      }
    }
    
    if (hasMeter) {
      const config = apiConfigs?.find((c: any) => c.service_type === 'meter');
      if (config) {
        apiCalls.push({
          endpoint: config.endpoint_url,
          type: "meter"
        });
      }
    }

    // Call all OneBill API endpoints
    const MAX_ERROR_LENGTH = 4096;
    const apiResults = await Promise.all(
      apiCalls.map(async ({ endpoint, type }) => {
        try {
          console.log(`Calling ${type} API:`, endpoint);
          
          const apiResponse = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${ONEBILL_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(parsedData)
          });

          let responseText = "";
          try {
            responseText = await apiResponse.text();
          } catch (e) {
            responseText = "Failed to read response body";
          }

          // Truncate error responses
          const truncatedResponse = responseText.slice(0, MAX_ERROR_LENGTH);
          
          console.log(`${type} API response:`, apiResponse.status, truncatedResponse.slice(0, 200));

          return {
            type,
            endpoint,
            status: apiResponse.status,
            ok: apiResponse.ok,
            response: truncatedResponse
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          console.error(`Error calling ${type} API:`, errorMessage);
          
          return {
            type,
            endpoint,
            status: 500,
            ok: false,
            error: errorMessage.slice(0, MAX_ERROR_LENGTH)
          };
        }
      })
    );

    // Check if all API calls succeeded
    const allSuccessful = apiResults.every(result => result.ok);

    return new Response(
      JSON.stringify({
        ok: allSuccessful,
        parsed_data: parsedData,
        services_detected: {
          electricity: hasElectricity,
          gas: hasGas,
          meter: hasMeter,
          broadband: services?.broadband || false
        },
        api_calls: apiResults,
        input_type: isPdf ? "pdf" : "image",
        used_conversion: usedConversion,
        visual_input_count: imageUrls.length,
        visual_inputs_sample: imageUrls.slice(0, 2)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in onebill-vision-parse:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const MAX_ERROR_LENGTH = 4096;
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage.slice(0, MAX_ERROR_LENGTH),
        stack: error instanceof Error ? error.stack?.slice(0, MAX_ERROR_LENGTH) : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
