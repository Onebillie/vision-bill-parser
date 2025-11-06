import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBillParser } from "@/hooks/useBillParser";
import { ParsingProgress } from "@/components/ParsingProgress";
import { FileUpload } from "@/components/FileUpload";
import { ServiceBadges } from "@/components/ServiceBadges";
import { ElectricityBillBreakdown } from "@/components/ElectricityBillBreakdown";
import { GasBillBreakdown } from "@/components/GasBillBreakdown";
import { BroadbandBreakdown } from "@/components/BroadbandBreakdown";
import { CustomerDetailsBreakdown } from "@/components/CustomerDetailsBreakdown";
import { AllFieldsDebugView } from "@/components/AllFieldsDebugView";

const Index = () => {
  const { phone, setPhone, loading, uploading, result, uploadedFile, progressStep, uploadFile } = useBillParser();

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">OneBill Vision Parse</h1>
          <p className="text-muted-foreground">
            Upload an Irish utility bill image to extract structured data
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Parse Document</CardTitle>
            <CardDescription>
              Upload a meter reading, gas bill, or electricity bill (JPG, PNG, WEBP, PDF)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone Number *</label>
              <Input
                placeholder="+353 XX XXX XXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading || uploading}
              />
            </div>
            <FileUpload
              onFileSelect={uploadFile}
              disabled={uploading || loading}
              currentFile={uploadedFile}
              isUploading={uploading}
            />
          </CardContent>
        </Card>

        <ParsingProgress currentStep={progressStep} />

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Parsing Results</CardTitle>
              <CardDescription>
                {result.ok ? "✓ All API calls successful" : "⚠ Some API calls failed"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {result.services_detected && (
                <div>
                  <h4 className="font-semibold mb-2 text-base">Services Detected:</h4>
                  <ServiceBadges {...result.services_detected} />
                </div>
              )}

              <Tabs defaultValue="customer" className="w-full">
                <TabsList className="grid w-full grid-cols-6">
                  <TabsTrigger value="customer">👤 Customer</TabsTrigger>
                  <TabsTrigger value="breakdown">📊 Breakdown</TabsTrigger>
                  <TabsTrigger value="all-fields">🔍 All Fields</TabsTrigger>
                  <TabsTrigger value="payload">📤 API Payload</TabsTrigger>
                  <TabsTrigger value="api">🔗 API Calls</TabsTrigger>
                  <TabsTrigger value="json">📄 Raw JSON</TabsTrigger>
                </TabsList>

                <TabsContent value="customer" className="space-y-6 mt-6">
                  <CustomerDetailsBreakdown data={result.parsed_data} />
                </TabsContent>

                <TabsContent value="breakdown" className="space-y-6 mt-6">
                  {result.parsed_data?.bills?.electricity && result.parsed_data.bills.electricity.length > 0 && (
                    <ElectricityBillBreakdown data={result.parsed_data.bills.electricity} />
                  )}

                  {result.parsed_data?.bills?.gas && result.parsed_data.bills.gas.length > 0 && (
                    <GasBillBreakdown data={result.parsed_data.bills.gas} />
                  )}

                  {result.parsed_data?.bills?.broadband && result.parsed_data.bills.broadband.length > 0 && (
                    <BroadbandBreakdown data={result.parsed_data.bills.broadband} />
                  )}

                  {(!result.parsed_data?.bills?.electricity || result.parsed_data.bills.electricity.length === 0) &&
                   (!result.parsed_data?.bills?.gas || result.parsed_data.bills.gas.length === 0) &&
                   (!result.parsed_data?.bills?.broadband || result.parsed_data.bills.broadband.length === 0) && (
                    <div className="text-center text-muted-foreground py-8">
                      No bill data available to display
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="all-fields" className="mt-6">
                  <AllFieldsDebugView data={result.parsed_data} />
                </TabsContent>

                <TabsContent value="payload" className="mt-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">API Payload</CardTitle>
                      <CardDescription>Exact JSON payload sent to OneBill API</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-[600px] border">
                        {JSON.stringify(result.parsed_data, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="api" className="mt-6">
                  {result.api_calls && result.api_calls.length > 0 ? (
                    <div className="space-y-3">
                      {result.api_calls.map((call: any, idx: number) => (
                        <Card key={idx} className="border">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <span className={`text-lg ${call.ok ? 'text-green-600' : 'text-red-600'}`}>
                                  {call.ok ? '✓' : '✗'}
                                </span>
                                <div>
                                  <div className="font-semibold capitalize">{call.type} Service</div>
                                  <div className="text-xs text-muted-foreground">HTTP {call.status}</div>
                                </div>
                              </div>
                              <span className={`px-3 py-1 rounded text-xs font-medium ${
                                call.ok 
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                              }`}>
                                {call.ok ? 'Success' : 'Failed'}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mb-2 font-mono">
                              {call.endpoint}
                            </div>
                            {call.response && (
                              <div className="mt-3 p-3 bg-muted rounded border">
                                <div className="text-xs font-semibold mb-2">Response:</div>
                                <pre className="text-xs overflow-auto max-h-40 text-muted-foreground">
                                  {call.response}
                                </pre>
                              </div>
                            )}
                            {call.error && (
                              <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                                <div className="text-xs font-semibold text-red-800 dark:text-red-200 mb-2">Error:</div>
                                <div className="text-xs text-red-700 dark:text-red-300">{call.error}</div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      No API calls were made
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="json" className="mt-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Complete Parsed JSON</CardTitle>
                      <CardDescription>Full structured data sent to OneBill API</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-[600px] border">
                        {JSON.stringify(result.parsed_data || result.data, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {result?.input_type && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="text-base">Debug Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-muted p-3 rounded-lg overflow-auto text-xs">
                      {JSON.stringify({
                        input_type: result.input_type,
                        used_conversion: result.used_conversion,
                        visual_input_count: result.visual_input_count,
                        visual_inputs_sample: result.visual_inputs_sample,
                      }, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Index;
