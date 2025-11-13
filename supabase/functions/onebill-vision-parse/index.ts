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

// Calculate parsing confidence score (0-100%)
function calculateConfidenceScore(parsedData: any, hasElectricityData: boolean, hasGasData: boolean): number {
  let score = 0;
  const weights = {
    keyFields: 40,      // 40% for presence of key fields
    dataCompleteness: 35, // 35% for completeness of billing data
    dateConsistency: 25   // 25% for date consistency
  };

  // 1. Key Fields Score (40 points)
  let keyFieldScore = 0;
  const keyFieldsToCheck = [
    { path: 'bills.customer[0].details.customer_name', points: 5 },
    { path: 'bills.customer[0].details.address', points: 5 },
    { path: 'bills.electricity[0].electricity_details.invoice_number', points: 7, condition: hasElectricityData },
    { path: 'bills.electricity[0].electricity_details.account_number', points: 7, condition: hasElectricityData },
    { path: 'bills.electricity[0].electricity_details.meter_details.mprn', points: 8, condition: hasElectricityData },
    { path: 'bills.gas[0].gas_details.invoice_number', points: 7, condition: hasGasData },
    { path: 'bills.gas[0].gas_details.account_number', points: 7, condition: hasGasData },
    { path: 'bills.gas[0].gas_details.gprn', points: 8, condition: hasGasData }
  ];

  keyFieldsToCheck.forEach(field => {
    // Skip if service not detected (condition explicitly false)
    if ('condition' in field && field.condition === false) return;
    
    const value = field.path.split('.').reduce((obj, key) => obj?.[key], parsedData);
    if (value && (typeof value !== 'string' || value.trim() !== '')) {
      keyFieldScore += field.points;
    }
  });

  score += Math.min(keyFieldScore, weights.keyFields);

  // 2. Data Completeness Score (35 points)
  let completenessScore = 0;
  
  if (hasElectricityData) {
    const elec = parsedData.bills.electricity?.[0];
    if (elec?.supplier_details?.billing_period) completenessScore += 5;
    if (elec?.supplier_details?.issue_date) completenessScore += 3;
    if (elec?.charges_and_usage?.meter_readings?.length > 0) completenessScore += 8;
    if (elec?.charges_and_usage?.detailed_kWh_usage?.length > 0) completenessScore += 6;
    if (elec?.charges_and_usage?.total_amount_due > 0) completenessScore += 6;
    if (elec?.electricity_details?.meter_details?.dg) completenessScore += 4;
    if (elec?.electricity_details?.meter_details?.mcc) completenessScore += 3;
  }
  
  if (hasGasData) {
    const gas = parsedData.bills.gas?.[0];
    if (gas?.supplier_details?.billing_period) completenessScore += 5;
    if (gas?.supplier_details?.issue_date) completenessScore += 3;
    if (gas?.charges_and_usage?.meter_readings?.length > 0) completenessScore += 8;
    if (gas?.charges_and_usage?.gas_usage?.length > 0) completenessScore += 6;
    if (gas?.charges_and_usage?.total_amount_due > 0) completenessScore += 6;
    if (gas?.gas_details?.conversion_factor) completenessScore += 3;
    if (gas?.gas_details?.calorific_value) completenessScore += 4;
  }

  score += Math.min(completenessScore, weights.dataCompleteness);

  // 3. Date Consistency Score (25 points)
  let dateScore = 25; // Start with perfect score, deduct for issues
  
  const checkDateConsistency = (service: any, serviceName: string) => {
    const billingPeriod = service?.supplier_details?.billing_period;
    if (!billingPeriod) {
      dateScore -= 5; // Missing billing period
      return;
    }

    const periodMatch = billingPeriod.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
    if (!periodMatch) {
      dateScore -= 3; // Invalid billing period format
      return;
    }

    const [, startStr, endStr] = periodMatch;
    const periodStart = parseDate(startStr);
    const periodEnd = parseDate(endStr);

    if (!periodStart || !periodEnd || periodStart >= periodEnd) {
      dateScore -= 5; // Invalid date range
      return;
    }

    // Check meter reading dates
    const readings = service?.charges_and_usage?.meter_readings || [];
    readings.forEach((reading: any) => {
      if (reading.date) {
        const readDate = parseDate(reading.date);
        if (readDate && (readDate < periodStart || readDate > periodEnd)) {
          dateScore -= 3; // Reading date outside billing period
        }
      }
    });

    // Check issue date
    const issueDate = service?.supplier_details?.issue_date;
    if (issueDate) {
      const issue = parseDate(issueDate);
      if (issue && issue < periodEnd) {
        dateScore -= 2; // Issue date before period end
      }
    }
  };

  if (hasElectricityData) checkDateConsistency(parsedData.bills.electricity?.[0], 'electricity');
  if (hasGasData) checkDateConsistency(parsedData.bills.gas?.[0], 'gas');

  score += Math.max(dateScore, 0);

  return Math.round(Math.min(score, 100));
}

// Parse date in DD/MM/YYYY format
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

const PARSE_PROMPT = `Parse Irish utility bills comprehensively. Extract EVERY visible field. Return ONE JSON object only. No prose.

⚠️ CRITICAL ANTI-HALLUCINATION RULES:
1. NEVER invent, guess, or fabricate data that is not clearly visible
2. If a field is not present, leave it EMPTY, null, or omit it completely
3. DO NOT invent GPRNs, MPRNs, DG codes, MCC codes, account numbers, or invoice numbers
4. Most bills are SINGLE-SERVICE (electricity OR gas only) - if you only see electricity data, leave ALL gas fields empty
5. If you only see gas data, leave ALL electricity fields empty
6. Combined bills are RARE and must have BOTH services CLEARLY visible with separate identifiers

CRITICAL: Distinguish between:
1. UTILITY BILLS: Documents with invoice numbers, account numbers, billing periods, meter readings, charges breakdown, and financial totals
2. METER PHOTOS: Physical meter displays (may show serial numbers, GPRN/MPRN visible on meter but NO invoice/billing data)
3. ANNUAL STATEMENTS: Multi-month usage summaries labeled "statement" or "annual review" (NOT bills)

METER PHOTO PARSING SPECIFICATIONS:
Photos are likely blurry, angled poorly, badly lit. Most important: Type of meter (electricity/gas) and the 5-digit reading(s).

1) CLASSIFY UTILITY FIRST:
   GAS INDICATORS:
   - Unit m³ or label "Meter Index … m³"
   - Roller counter with last digit(s) on RED background or with decimal
   - Models: BK-G4, G4, Apator G4, Landis+Gyr L210 (gas smart)
   - Labels: "Gas Networks Ireland", "Bord Gáis"
   
   ELECTRICITY INDICATORS:
   - Unit kWh (or kvarh shown nearby)
   - Phrases/labels: A+, T1/T2, ESB Networks, Sagemcom, Kamstrup
   
   Return: utility = "gas" or "electricity"

2) EXTRACT READINGS (critical rules):
   GAS METERS (m³):
   - Use integer BEFORE decimal point or red digits
   - Examples:
     * "Meter Index 02331.350 m³" → read_value=2331
     * Roller "12038 8 m³" (final red digit is decimal) → read_value=12038
     * "15019[red 57] m³" → read_value=15019
     * "17113[red 5] m³" → read_value=17113
   - Fields: read_value (integer), unit="m3"
   - Strip leading zeros: 02331 → 2331
   
   ELECTRICITY METERS (kWh):
   - Capture main kWh value shown
   - Examples:
     * "39147 kWh" → read_value=39147
     * "I.8.0 A+ 3359 kWh" → read_value=3359
   - If BOTH T1 and T2 visible: extract each AND compute total = T1 + T2
   - Digital meters have multiple reads (TOU/Time of use tariffs, import/export)
   - Photos may show button cycling/menu navigation - read ALL visible values
   - Prefer I.8.0 (total) if exists, else send currently displayed T-register
   - Field: read_value (integer), unit="kWh", register (T1/T2/I.8.0)

3) ALWAYS INCLUDE:
   - meter_make, meter_model if visible (Elster, BK-G4, Sagemcom XS211, Landis+Gyr L210, Kamstrup, Apator G4)
   - serial_number if visible (barcode/plate)
   - register if shown (T1, T2, I.8.0)
   - confidence (0-1) for detection accuracy and parsed reading accuracy
   - raw_text (OCR'd text block for audit)

4) EDGE CASES & VALIDATION:
   - Strip leading zeros (02331 → 2331)
   - Reject clearly partial frames (cropped counter, unreadable units) with is_meter=false
   - NEVER convert gas m³ to kWh
   - Round DOWN on gas where decimals/colored digits appear
   - For electricity with multiple registers: prefer I.8.0 total if exists

For METER PHOTOS: 
- Extract: meter_manufacturer, meter_model, meter_serial_number, current_reading_display, meter_type, visible_identifiers, utility, read_value, unit, register, confidence, raw_text
- Leave blank: invoice_number, account_number, billing_period, charges, financial fields

For UTILITY BILLS:
- Extract EVERY field visible: customer info, service addresses, all meter readings with dates and types, unit rates, charges breakdown, PSO levy, carbon tax, VAT details, discounts, payment methods, direct debit info, contract dates, tariff names, carbon emissions, efficiency tips
- ⚠️ CRITICAL: Extract data ONLY for the service(s) present in the document
- ⚠️ If you see ONLY electricity data (MPRN, DG, MCC, kWh charges), DO NOT populate ANY gas fields (leave gas array EMPTY)
- ⚠️ If you see ONLY gas data (GPRN, m³ charges), DO NOT populate ANY electricity fields (leave electricity array EMPTY)
- Most Irish bills are SINGLE-SERVICE - combined bills are uncommon and must show BOTH services with separate sections
- Meter readings MUST include: meter_number, read_date, read_type (A/E/CU), previous_reading, current_reading, units_consumed, unit_type (Day/Night/Peak/etc), rate_per_unit
- Validate: All meter reading dates MUST fall within billing_period dates
- Billing period: Extract exact start_date and end_date in YYYY-MM-DD format, calculate days_count

COMPREHENSIVE FIELD LIST TO EXTRACT:

**Customer & Account:**
customer_name, billing_address (structured object), supply_address, vat_number, vat_registration_address, account_number, invoice_number, bill_number

**Billing Period:**
billing_period.start_date, billing_period.end_date, billing_period.days_count, issue_date, billing_date, due_date, payment_due_date

**Meter Identifiers:**
Electricity (mandatory): mprn, dg, mcc_type
Electricity (optional): profile (01, 02, 04, 27, etc - not all bills have this)
Gas (mandatory): gprn
Meter Photo: meter_serial_number, meter_manufacturer, meter_model

**Meter Readings Array (structured):**
Each reading: meter_number, meter_serial, read_date, read_type, previous_reading, current_reading, interim_reading, multiplier, units_consumed, unit_type, rate_per_unit, total_charge, time_window

**Charges Breakdown:**
electricity_charges array (description, units, rate, amount), standing_charge, pso_levy, carbon_tax, discounts, microgen_credit, subtotal_before_vat, vat_rate, vat_amount, total_including_vat

**Financial:**
previous_balance, payments_received, amount_outstanding, total_amount_due, direct_debit_collection_date

**Broadband:**
plan_name, phone_number, broadband_service_number, uan_numbers, iban, bic

**Extra Context:**
service_provider, tariff_name, contract_end_date, payment_method, average_daily_use, comparison_same_period_last_year, comparison_average_residential, carbon_emissions_kg, energy_efficiency_tips, emergency_contact_numbers, customer_service_hours, complaint_process_info, fuel_mix_information

Rules:
- Dates: "YYYY-MM-DD"; unknown → "0000-00-00"
- Numbers: numeric; unknown → 0
- Booleans: true/false (not strings)
- Currencies: "cent" or "euro"
- Always include all top-level sections; empty arrays if not present
- Do NOT hallucinate GPRN from meter serial numbers or barcodes on meter photos
- Extract identifiers ONLY when clearly labeled as MPRN/GPRN, not from random numbers`;

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

    // ========== POST-PARSING DATA CONSISTENCY VALIDATION ==========
    // Cross-check parsed data to detect and remove hallucinated fields
    console.log("🔍 Running data consistency validation...");
    
    const electricityData = parsedData.bills.electricity?.[0];
    const gasData = parsedData.bills.gas?.[0];
    
    // Count substantial data points for each service
    const countElectricityData = () => {
      if (!electricityData) return 0;
      return [
        !!electricityData.electricity_details?.invoice_number,
        !!electricityData.electricity_details?.account_number,
        !!electricityData.electricity_details?.meter_details?.mprn,
        !!electricityData.electricity_details?.meter_details?.dg,
        !!electricityData.supplier_details?.billing_period,
        !!electricityData.charges_and_usage?.meter_readings?.length,
        !!electricityData.charges_and_usage?.unit_rates,
        !!(electricityData.financial_information?.total_due && electricityData.financial_information.total_due > 0)
      ].filter(Boolean).length;
    };
    
    const countGasData = () => {
      if (!gasData) return 0;
      return [
        !!gasData.gas_details?.invoice_number,
        !!gasData.gas_details?.account_number,
        !!gasData.gas_details?.meter_details?.gprn,
        !!gasData.supplier_details?.billing_period,
        !!gasData.charges_and_usage?.meter_readings?.length,
        !!gasData.charges_and_usage?.unit_rates,
        !!(gasData.financial_information?.total_due && gasData.financial_information.total_due > 0)
      ].filter(Boolean).length;
    };
    
    const electricityDataPoints = countElectricityData();
    const gasDataPoints = countGasData();
    
    console.log("Data points:", { electricity: electricityDataPoints, gas: gasDataPoints });
    
    // Check service provider names for single-service validation
    const electricityProvider = electricityData?.supplier_details?.name?.toLowerCase() || "";
    const gasProvider = gasData?.supplier_details?.name?.toLowerCase() || "";
    
    const electricityOnlyProviders = ["electric ireland", "esb networks", "esb energy", "energia"];
    const gasOnlyProviders = ["flogas", "natural gas"];
    
    const isElectricityOnlyProvider = electricityOnlyProviders.some(p => electricityProvider.includes(p));
    const isGasOnlyProvider = gasOnlyProviders.some(p => gasProvider.includes(p));
    
    // VALIDATION RULE 1: If one service has substantial data (4+) and the other has minimal data (≤2), clear the weak service
    if (electricityDataPoints >= 4 && gasDataPoints <= 2 && gasDataPoints > 0) {
      console.warn("⚠️ VALIDATION: Clearing gas data - electricity has substantial data but gas appears hallucinated");
      parsedData.bills.gas = [];
    } else if (gasDataPoints >= 4 && electricityDataPoints <= 2 && electricityDataPoints > 0) {
      console.warn("⚠️ VALIDATION: Clearing electricity data - gas has substantial data but electricity appears hallucinated");
      parsedData.bills.electricity = [];
    }
    
    // VALIDATION RULE 2: If service provider is known single-service, clear the other service
    if (isElectricityOnlyProvider && gasDataPoints > 0) {
      console.warn(`⚠️ VALIDATION: Clearing gas data - provider '${electricityProvider}' is electricity-only`);
      parsedData.bills.gas = [];
    } else if (isGasOnlyProvider && electricityDataPoints > 0) {
      console.warn(`⚠️ VALIDATION: Clearing electricity data - provider '${gasProvider}' is gas-only`);
      parsedData.bills.electricity = [];
    }
    
    // VALIDATION RULE 3: If identifier exists but NO billing fields (invoice, account, billing period), clear that service
    const hasElectricityIdentifier = !!(electricityData?.electricity_details?.meter_details?.mprn || electricityData?.electricity_details?.meter_details?.dg);
    const hasElectricityBillingFields = !!(electricityData?.electricity_details?.invoice_number || electricityData?.electricity_details?.account_number || electricityData?.supplier_details?.billing_period);
    
    const hasGasIdentifier = !!gasData?.gas_details?.meter_details?.gprn;
    const hasGasBillingFields = !!(gasData?.gas_details?.invoice_number || gasData?.gas_details?.account_number || gasData?.supplier_details?.billing_period);
    
    if (hasElectricityIdentifier && !hasElectricityBillingFields && electricityDataPoints <= 1) {
      console.warn("⚠️ VALIDATION: Clearing electricity data - has identifier but zero billing fields (likely meter photo)");
      parsedData.bills.electricity = [];
    }
    
    if (hasGasIdentifier && !hasGasBillingFields && gasDataPoints <= 1) {
      console.warn("⚠️ VALIDATION: Clearing gas data - has identifier but zero billing fields (likely meter photo or hallucination)");
      parsedData.bills.gas = [];
    }
    
    console.log("✅ Data consistency validation complete");
    // ========== END VALIDATION ==========

    // Document classification based on parsed fields (using validated data - reuse variables from validation)
    const mprn = parsedData.bills.electricity?.[0]?.electricity_details?.meter_details?.mprn;
    const dg = parsedData.bills.electricity?.[0]?.electricity_details?.meter_details?.dg;
    const mcc = parsedData.bills.electricity?.[0]?.electricity_details?.meter_details?.mcc;

    // Check if electricity has IDENTIFIER and BILL DATA (not just identifier) - reuse from validation
    const hasElectricityIdentifierForClassification = !!(mprn || dg);
    // ENHANCED: Count solid billing indicators (require at least 3 for strict bill classification)
    const electricityBillingIndicators = [
      !!parsedData.bills.electricity?.[0]?.electricity_details?.invoice_number,
      !!parsedData.bills.electricity?.[0]?.electricity_details?.account_number,
      !!parsedData.bills.electricity?.[0]?.supplier_details?.billing_period,
      !!(parsedData.bills.electricity?.[0]?.financial_information?.total_due && parsedData.bills.electricity[0].financial_information.total_due > 0),
      !!(parsedData.bills.electricity?.[0]?.charges_and_usage?.meter_readings && parsedData.bills.electricity[0].charges_and_usage.meter_readings.length > 0),
      !!(parsedData.bills.electricity?.[0]?.charges_and_usage?.unit_rates)
    ].filter(Boolean).length;
    const hasElectricityBillData = electricityBillingIndicators >= 3;
    const hasElectricityData = hasElectricityIdentifierForClassification && hasElectricityBillData;
    
    // Check if gas has IDENTIFIER and BILL DATA (not just identifier)
    const gprn = parsedData.bills.gas?.[0]?.gas_details?.meter_details?.gprn;
    const hasGasIdentifierForClassification = !!gprn;
    // ENHANCED: Count solid billing indicators (require at least 3 for strict bill classification)
    const gasBillingIndicators = [
      !!parsedData.bills.gas?.[0]?.gas_details?.invoice_number,
      !!parsedData.bills.gas?.[0]?.gas_details?.account_number,
      !!parsedData.bills.gas?.[0]?.supplier_details?.billing_period,
      !!(parsedData.bills.gas?.[0]?.financial_information?.total_due && parsedData.bills.gas[0].financial_information.total_due > 0),
      !!(parsedData.bills.gas?.[0]?.charges_and_usage?.meter_readings && parsedData.bills.gas[0].charges_and_usage.meter_readings.length > 0),
      !!(parsedData.bills.gas?.[0]?.charges_and_usage?.unit_rates)
    ].filter(Boolean).length;
    const hasGasBillData = gasBillingIndicators >= 3;
    const hasGasData = hasGasIdentifierForClassification && hasGasBillData;
    
    // Date correlation validation for meter readings
    const validateMeterReadingDates = (billingPeriod: string, readings: any[]): string[] => {
      const warnings: string[] = [];
      if (!billingPeriod || !readings || readings.length === 0) return warnings;
      
      // Parse billing period (format: "DD MMM YYYY - DD MMM YYYY" or similar)
      const periodMatch = billingPeriod.match(/(\d{4}-\d{2}-\d{2})/g);
      if (!periodMatch || periodMatch.length < 2) return warnings;
      
      const [periodStart, periodEnd] = periodMatch;
      const startDate = new Date(periodStart);
      const endDate = new Date(periodEnd);
      
      readings.forEach((reading, idx) => {
        const readDate = reading.date || reading.read_date;
        if (!readDate || readDate === "0000-00-00") return;
        
        const date = new Date(readDate);
        if (date < startDate || date > endDate) {
          warnings.push(`Meter reading ${idx + 1} date ${readDate} falls outside billing period ${periodStart} to ${periodEnd}`);
        }
      });
      
      return warnings;
    };
    
    const electricityDateWarnings = parsedData.bills.electricity?.[0]?.supplier_details?.billing_period && parsedData.bills.electricity[0]?.charges_and_usage?.meter_readings
      ? validateMeterReadingDates(parsedData.bills.electricity[0].supplier_details.billing_period, parsedData.bills.electricity[0].charges_and_usage.meter_readings)
      : [];
    const gasDateWarnings = parsedData.bills.gas?.[0]?.supplier_details?.billing_period && parsedData.bills.gas[0]?.charges_and_usage?.meter_readings
      ? validateMeterReadingDates(parsedData.bills.gas[0].supplier_details.billing_period, parsedData.bills.gas[0].charges_and_usage.meter_readings)
      : [];
    
    if (electricityDateWarnings.length > 0) {
      console.warn("⚠️ Electricity meter reading date warnings:", electricityDateWarnings);
    }
    if (gasDateWarnings.length > 0) {
      console.warn("⚠️ Gas meter reading date warnings:", gasDateWarnings);
    }
    
    console.log("Classification check:", { 
      mprn, 
      dg, 
      mcc,
      gprn,
      hasElectricityIdentifier: hasElectricityIdentifierForClassification,
      electricityBillingIndicators,
      hasElectricityBillData,
      hasElectricityData,
      hasGasIdentifier: hasGasIdentifierForClassification,
      gasBillingIndicators,
      hasGasBillData,
      hasGasData,
      electricityDateWarnings: electricityDateWarnings.length,
      gasDateWarnings: gasDateWarnings.length
    });

    // Determine document type classification with enhanced logic
    if (hasElectricityData && hasGasData) {
      console.log("📋 COMBINED BILL DETECTED: Contains both electricity and gas billing data (3+ indicators each) - will send to multiple APIs");
    } else if (hasElectricityData) {
      console.log(`⚡ ELECTRICITY BILL: Contains electricity billing data (identifier + ${electricityBillingIndicators}/6 billing indicators)`);
    } else if (hasGasData) {
      console.log(`🔥 GAS BILL: Contains gas billing data (identifier + ${gasBillingIndicators}/6 billing indicators)`);
    } else if (hasElectricityIdentifierForClassification || hasGasIdentifierForClassification) {
      console.log(`📸 METER PHOTO: Has identifier visible but insufficient billing data (E:${electricityBillingIndicators}, G:${gasBillingIndicators}) - defaulting to meter API`);
    } else {
      console.log("📊 METER READING: No identifiers or billing data - defaulting to meter API");
    }

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

    // Prepare API calls based on classification (supports multiple APIs for combined bills)
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

    // Calculate confidence score
    const confidenceScore = calculateConfidenceScore(parsedData, hasElectricityData, hasGasData);
    console.log(`✅ Confidence score: ${confidenceScore}%`);

    // Check if all API calls succeeded
    const allSuccessful = apiResults.every(result => result.ok);

    return new Response(
      JSON.stringify({
        ok: allSuccessful,
        confidence_score: confidenceScore,
        parsed_data: parsedData,
        services_detected: {
          electricity: hasElectricityData,
          gas: hasGasData,
          meter: !hasElectricityData && !hasGasData,
          broadband: parsedData.bills.broadband?.length > 0
        },
        classification_details: {
          electricity_billing_indicators: electricityBillingIndicators,
          gas_billing_indicators: gasBillingIndicators,
          electricity_date_warnings: electricityDateWarnings,
          gas_date_warnings: gasDateWarnings
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
