import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

interface AllFieldsDebugViewProps {
  data: any;
}

export const AllFieldsDebugView = ({ data }: AllFieldsDebugViewProps) => {
  if (!data || !data.bills) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All Extracted Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No data available</p>
        </CardContent>
      </Card>
    );
  }

  const hasValue = (value: any): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && (value === '' || value === '0000-00-00')) return false;
    if (typeof value === 'number' && value === 0) return false;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  };

  const renderValue = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  const renderFields = (obj: any, parentKey: string = '') => {
    return Object.entries(obj).map(([key, value]) => {
      const fullKey = parentKey ? `${parentKey}.${key}` : key;
      const populated = hasValue(value);

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return (
          <div key={fullKey} className="ml-4 border-l-2 border-muted pl-4 my-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-sm">{key}</span>
              <Badge variant="outline" className="text-xs">object</Badge>
            </div>
            {renderFields(value, fullKey)}
          </div>
        );
      }

      if (Array.isArray(value)) {
        return (
          <div key={fullKey} className="ml-4 border-l-2 border-muted pl-4 my-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-sm">{key}</span>
              <Badge variant="outline" className="text-xs">array [{value.length}]</Badge>
            </div>
            {value.length > 0 ? (
              value.map((item, idx) => (
                <div key={`${fullKey}[${idx}]`} className="ml-4 mb-2">
                  <div className="text-xs text-muted-foreground mb-1">Index {idx}</div>
                  {typeof item === 'object' ? renderFields(item, `${fullKey}[${idx}]`) : (
                    <div className="flex items-center gap-2">
                      <Badge variant={hasValue(item) ? "default" : "secondary"} className="text-xs">
                        {hasValue(item) ? '✓' : '∅'}
                      </Badge>
                      <code className="text-xs bg-muted px-2 py-1 rounded">{renderValue(item)}</code>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-xs ml-4">Empty array</p>
            )}
          </div>
        );
      }

      return (
        <div key={fullKey} className="flex items-start gap-2 py-2 border-b border-muted/30">
          <Badge variant={populated ? "default" : "secondary"} className="text-xs mt-0.5">
            {populated ? '✓' : '∅'}
          </Badge>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm break-all">{key}</div>
            <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded inline-block mt-1 break-all max-w-full">
              {renderValue(value)}
            </code>
          </div>
        </div>
      );
    });
  };

  const sections = [
    { key: 'cus_details', title: '👤 Customer Details', icon: '👤' },
    { key: 'electricity', title: '⚡ Electricity Bills', icon: '⚡' },
    { key: 'gas', title: '🔥 Gas Bills', icon: '🔥' },
    { key: 'broadband', title: '📡 Broadband Bills', icon: '📡' }
  ];

  const countFields = (obj: any): { total: number; populated: number } => {
    let total = 0;
    let populated = 0;

    const count = (o: any) => {
      Object.entries(o).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          count(value);
        } else if (Array.isArray(value)) {
          value.forEach(item => {
            if (typeof item === 'object' && item !== null) {
              count(item);
            } else {
              total++;
              if (hasValue(item)) populated++;
            }
          });
        } else {
          total++;
          if (hasValue(value)) populated++;
        }
      });
    };

    count(obj);
    return { total, populated };
  };

  const stats = countFields(data.bills);
  const completeness = stats.total > 0 ? ((stats.populated / stats.total) * 100).toFixed(1) : '0';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>🔍 All Extracted Fields</span>
          <div className="flex gap-2 items-center text-sm font-normal">
            <Badge variant="outline">{stats.populated} / {stats.total} fields</Badge>
            <Badge variant={parseFloat(completeness) > 80 ? "default" : parseFloat(completeness) > 50 ? "secondary" : "destructive"}>
              {completeness}% complete
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 p-3 bg-muted rounded-lg text-sm">
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-xs">✓</Badge>
              <span>Populated field</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">∅</Badge>
              <span>Empty/default value</span>
            </div>
          </div>
        </div>

        <Accordion type="multiple" className="w-full">
          {sections.map(section => {
            const sectionData = data.bills[section.key];
            if (!sectionData) return null;

            const sectionStats = Array.isArray(sectionData) && sectionData.length > 0
              ? countFields({ [section.key]: sectionData })
              : countFields(sectionData);

            return (
              <AccordionItem key={section.key} value={section.key}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <span className="flex items-center gap-2">
                      <span>{section.icon}</span>
                      <span>{section.title}</span>
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {sectionStats.populated} / {sectionStats.total}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1 pt-2">
                    {Array.isArray(sectionData) && sectionData.length > 0 ? (
                      sectionData.map((item, idx) => (
                        <div key={idx} className="mb-4">
                          <div className="font-semibold text-sm mb-2 text-muted-foreground">
                            Record {idx + 1}
                          </div>
                          {renderFields(item)}
                        </div>
                      ))
                    ) : (
                      renderFields(sectionData)
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
};
