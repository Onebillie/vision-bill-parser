import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const Index = () => {
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();

  const handleParse = async () => {
    if (!imageUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter an image URL",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onebill-vision-parse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
          },
          body: JSON.stringify({ image_url: imageUrl })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Parse failed");
      }

      setResult(data);
      toast({
        title: "Success",
        description: "Bill parsed successfully!"
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to parse bill",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

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
            <CardTitle>Parse Bill Image</CardTitle>
            <CardDescription>
              Enter a publicly accessible image URL of your bill (JPG, PNG, or WEBP)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com/bill.jpg"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                disabled={loading}
              />
              <Button onClick={handleParse} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  "Parse Bill"
                )}
              </Button>
            </div>

            {imageUrl && (
              <div className="border rounded-lg overflow-hidden">
                <img
                  src={imageUrl}
                  alt="Bill preview"
                  className="w-full h-auto"
                  onError={() =>
                    toast({
                      title: "Invalid image URL",
                      description: "Could not load the image",
                      variant: "destructive"
                    })
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Parsed Results</CardTitle>
              <CardDescription>
                {result.routed?.length > 0 &&
                  `Routed to: ${result.routed.map((r: any) => r.endpoint).join(", ")}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-auto text-sm">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Index;
