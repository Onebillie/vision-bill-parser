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
- Detect utilities using strong signals (MPRN/MCC/DG ⇒ electricity; GPRN/carbon tax ⇒ gas; broadband cues for broadband).
- Do not rename, add, or remove keys.`;

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
      fileUrl = `${supabaseUrl}/storage/v1/object/public/bills/${encodeURIComponent(file_path)}`;
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

    // Document classification based on parsed fields
    // Check for electricity fields (mprn or dg)
    const electricityData = parsedData.bills.electricity?.[0];
    const mprn = electricityData?.electricity_details?.meter_details?.mprn;
    const dg = electricityData?.electricity_details?.meter_details?.dg;
    const mcc = electricityData?.electricity_details?.meter_details?.mcc;
    const hasElectricityData = !!(mprn || dg);
    
    // Check for gas fields (gprn)
    const gasData = parsedData.bills.gas?.[0];
    const gprn = gasData?.gas_details?.meter_details?.gprn;
    const hasGasData = !!gprn;
    
    console.log("Classification check:", { 
      mprn, 
      dg, 
      mcc,
      gprn,
      hasElectricityData,
      hasGasData
    });

    // Helper functions for normalization
    const normalizePhone = (p: string) => p.replace(/\s+/g, '');
    const prefixMcc = (val: string | undefined) => {
      if (!val) return "";
      const upper = val.toUpperCase();
      return upper.startsWith("MCC") ? upper : `MCC${upper}`;
    };
    const prefixDg = (val: string | undefined) => {
      if (!val) return "";
      const upper = val.toUpperCase();
      return upper.startsWith("DG") ? upper : `DG${upper}`;
    };

    // Prepare API calls based on classification
    const apiCalls: Array<{ endpoint: string; type: string; payload?: any }> = [];
    
    // Classify as Electricity-File if mprn or dg exists
    if (hasElectricityData) {
      apiCalls.push({
        endpoint: "https://api.onebill.ie/api/electricity-file",
        type: "electricity",
        payload: {
          phone: normalizePhone(phone),
          mprn: mprn || "",
          mcc_type: prefixMcc(mcc),
          dg_type: prefixDg(dg)
        }
      });
    }
    
    // Classify as Gas-File if gprn exists
    if (hasGasData) {
      apiCalls.push({
        endpoint: "https://api.onebill.ie/api/gas-file",
        type: "gas",
        payload: {
          phone: normalizePhone(phone),
          gprn: gprn || ""
        }
      });
    }
    
    // Default to Meter API if not enough data to classify
    if (!hasElectricityData && !hasGasData) {
      console.log("Not enough data to classify - defaulting to Meter API");
      apiCalls.push({
        endpoint: "https://api.onebill.ie/api/meter-file",
        type: "meter"
      });
    }

    // Call all OneBill API endpoints
    const MAX_ERROR_LENGTH = 4096;
    const apiResults = await Promise.all(
      apiCalls.map(async ({ endpoint, type, payload }) => {
        try {
          console.log(`Calling ${type} API:`, endpoint);
          console.log(`Payload:`, JSON.stringify(payload || {}, null, 2));

          let apiResponse: Response;
          let responseText = "";

          if (type === "meter") {
            // Meter API: Send original uploaded file as multipart/form-data
            const form = new FormData();
            try {
              const fileResp = await fetch(fileUrl);
              const arrayBuf = await fileResp.arrayBuffer();
              const contentType = fileResp.headers.get("content-type") ||
                (fileUrl.toLowerCase().endsWith(".png") ? "image/png" :
                 fileUrl.toLowerCase().endsWith(".jpg") || fileUrl.toLowerCase().endsWith(".jpeg") ? "image/jpeg" :
                 fileUrl.toLowerCase().endsWith(".pdf") ? "application/pdf" :
                 "application/octet-stream");
              const fileName = typeof file_path === "string" && file_path.length > 0 ? file_path : "upload.bin";
              const blob = new Blob([new Uint8Array(arrayBuf)], { type: contentType });
              form.append("file", blob, fileName);
            } catch (e) {
              console.error("Failed to fetch original file for meter upload:", e);
              throw e;
            }
            form.append("phone", phone);

            apiResponse = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${ONEBILL_API_KEY}`
                // Do NOT set Content-Type when sending FormData; the runtime will set the correct boundary
              },
              body: form
            });
          } else if (type === "electricity" || type === "gas") {
            // Electricity/Gas: Send multipart/form-data with file + extracted fields
            const form = new FormData();
            try {
              const fileResp = await fetch(fileUrl);
              const arrayBuf = await fileResp.arrayBuffer();
              const contentType = fileResp.headers.get("content-type") ||
                (fileUrl.toLowerCase().endsWith(".png") ? "image/png" :
                 fileUrl.toLowerCase().endsWith(".jpg") || fileUrl.toLowerCase().endsWith(".jpeg") ? "image/jpeg" :
                 fileUrl.toLowerCase().endsWith(".pdf") ? "application/pdf" :
                 "application/octet-stream");
              const fileName = typeof file_path === "string" && file_path.length > 0 ? file_path : "upload.bin";
              const blob = new Blob([new Uint8Array(arrayBuf)], { type: contentType });
              form.append("file", blob, fileName);
            } catch (e) {
              console.error(`Failed to fetch original file for ${type} upload:`, e);
              throw e;
            }
            
            // Append text fields from payload
            for (const [key, value] of Object.entries(payload || {})) {
              form.append(key, String(value));
            }
            
            console.log(`${type} fields (non-binary):`, JSON.stringify(payload, null, 2));

            apiResponse = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${ONEBILL_API_KEY}`
                // Do NOT set Content-Type when sending FormData
              },
              body: form
            });
          } else {
            throw new Error(`Unknown API type: ${type}`);
          }

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
            response: truncatedResponse,
            payload: type === "meter" ? { file: "[multipart file]", phone } : payload
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          console.error(`Error calling ${type} API:`, errorMessage);
          
          return {
            type,
            endpoint,
            status: 500,
            ok: false,
            error: errorMessage.slice(0, MAX_ERROR_LENGTH),
            payload: type === "meter" ? { file: "[multipart file]", phone } : payload
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
          electricity: hasElectricityData,
          gas: hasGasData,
          meter: !hasElectricityData && !hasGasData,
          broadband: parsedData.bills.broadband?.length > 0
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
