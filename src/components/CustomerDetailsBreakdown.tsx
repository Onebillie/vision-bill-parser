import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface CustomerDetailsBreakdownProps {
  data: any;
}

export const CustomerDetailsBreakdown = ({ data }: CustomerDetailsBreakdownProps) => {
  if (!data || !data.bills || !data.bills.cus_details || data.bills.cus_details.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No customer details available</p>
        </CardContent>
      </Card>
    );
  }

  const customer = data.bills.cus_details[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          👤 Customer Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Basic Information */}
        <div>
          <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Basic Information</h4>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Name</TableCell>
                <TableCell>{customer.name || 'N/A'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Address Information */}
        <div>
          <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Address</h4>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Address Line 1</TableCell>
                <TableCell>{customer.line_1 || 'N/A'}</TableCell>
              </TableRow>
              {customer.line_2 && (
                <TableRow>
                  <TableCell className="font-medium">Address Line 2</TableCell>
                  <TableCell>{customer.line_2}</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className="font-medium">City</TableCell>
                <TableCell>{customer.city || 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">County</TableCell>
                <TableCell>{customer.county || 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Eircode</TableCell>
                <TableCell className="font-mono">{customer.eircode || 'N/A'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Service Flags */}
        <div>
          <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Services</h4>
          <div className="flex gap-2 flex-wrap">
            <Badge variant={customer.electricity ? "default" : "outline"}>
              ⚡ Electricity {customer.electricity ? "✓" : "✗"}
            </Badge>
            <Badge variant={customer.gas ? "default" : "outline"}>
              🔥 Gas {customer.gas ? "✓" : "✗"}
            </Badge>
            <Badge variant={customer.broadband ? "default" : "outline"}>
              📡 Broadband {customer.broadband ? "✓" : "✗"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
