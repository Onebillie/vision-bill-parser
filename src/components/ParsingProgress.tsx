import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParsingProgressProps {
  currentStep: "idle" | "uploading" | "analyzing" | "sending" | "complete" | "error";
}

const steps = [
  { id: "uploading", label: "Uploading file" },
  { id: "analyzing", label: "Analyzing document" },
  { id: "sending", label: "Sending to API" },
];

export const ParsingProgress = ({ currentStep }: ParsingProgressProps) => {
  if (currentStep === "idle") return null;

  const getStepStatus = (stepId: string) => {
    const stepIndex = steps.findIndex(s => s.id === stepId);
    const currentIndex = steps.findIndex(s => s.id === currentStep);
    
    if (currentStep === "complete") return "complete";
    if (currentStep === "error") return "error";
    if (stepIndex < currentIndex) return "complete";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
      <h3 className="text-sm font-medium">Processing...</h3>
      <div className="space-y-3">
        {steps.map((step) => {
          const status = getStepStatus(step.id);
          return (
            <div key={step.id} className="flex items-center gap-3">
              {status === "complete" && (
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
              )}
              {status === "active" && (
                <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
              )}
              {status === "pending" && (
                <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              {status === "error" && (
                <Circle className="h-5 w-5 text-destructive flex-shrink-0" />
              )}
              <span
                className={cn(
                  "text-sm",
                  status === "complete" && "text-green-600 font-medium",
                  status === "active" && "text-foreground font-medium",
                  status === "pending" && "text-muted-foreground",
                  status === "error" && "text-destructive"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
